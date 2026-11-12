import { Component, OnInit, OnDestroy, ViewChild, ElementRef, ChangeDetectorRef, signal, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute } from '@angular/router';
import {
  IonContent,
  IonButton,
  IonIcon,
  IonText,
  IonSpinner,
  IonAvatar,
  IonChip,
  IonBadge,
  NavController,
  AlertController,
  ToastController
} from '@ionic/angular/standalone';
import { Subject, interval, Subscription, firstValueFrom } from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import { TranslatePipe } from '@ngx-translate/core';

import { VideoCallService } from '../../core/services/video-call.service';
import { AttachableTrack, ConnectionStatus, ParticipantInfo, VideoCallConfig } from '../../core/services/video-call.types';
import { TranslationService } from '../../core/services/translation.service';
import { ConsultationService } from '../../core/services/consultation.service';
import { ConsultationWebSocketService } from '../../core/services/consultation-websocket.service';
import { ConsultationCryptoService } from '../../core/services/consultation-crypto.service';
import { EncryptionService } from '../../core/services/encryption.service';
import { AuthService } from '../../core/services/auth.service';
import { IncomingCallService } from '../../core/services/incoming-call.service';
import { ConsultationMessage, User } from '../../core/models/consultation.model';
import { WebSocketState } from '../../core/models/websocket.model';
import { MessageListComponent, Message, SendMessageData, EditMessageData, DeleteMessageData } from '../../shared/components/message-list/message-list';
import { PreJoinLobbyComponent } from '../../shared/components/pre-join-lobby/pre-join-lobby.component';
import { MediaTrackDirective } from '../../shared/directives/media-track.directive';
import { IPreJoinSettings } from '../../core/models/media-device.model';

@Component({
  selector: 'app-video-consultation',
  templateUrl: './video-consultation.page.html',
  styleUrls: ['./video-consultation.page.scss'],
  standalone: true,
  imports: [
    CommonModule,
    IonContent,
    IonButton,
    IonIcon,
    IonText,
    IonSpinner,
    IonAvatar,
    IonChip,
    IonBadge,
    MessageListComponent,
    PreJoinLobbyComponent,
    MediaTrackDirective,
    TranslatePipe
  ]
})
export class VideoConsultationPage implements OnInit, OnDestroy {
  private t = inject(TranslationService);

  @ViewChild('localVideo') localVideoRef!: ElementRef<HTMLVideoElement>;
  @ViewChild('localScreenShare') localScreenShareRef!: ElementRef<HTMLVideoElement>;
  @ViewChild('participantsContainer') participantsContainerRef!: ElementRef<HTMLDivElement>;

  appointmentId: number | null = null;
  consultationId: number | null = null;

  connectionStatus: ConnectionStatus = 'disconnected';
  participants: Map<string, ParticipantInfo> = new Map();
  localVideoTrack: AttachableTrack | null = null;
  localScreenShareTrack: AttachableTrack | null = null;

  isCameraEnabled = false;
  isMicrophoneEnabled = false;
  isScreenShareEnabled = false;
  isSpeakerOn = true;

  callDuration = 0;
  formattedDuration = '00:00';
  isLoading = false;
  errorMessage = '';

  showChat = signal(false);
  unreadCount = signal(0);
  chatAvailable = signal(true);
  phase = signal<'lobby' | 'connecting' | 'in-call'>('lobby');
  messages = signal<Message[]>([]);
  isLoadingMore = signal(false);
  hasMore = signal(true);

  private destroy$ = new Subject<void>();
  private durationTimer: Subscription | null = null;

  private currentUser = signal<User | null>(null);
  private currentPage = 1;
  private consultationPrivateKey: CryptoKey | null = null;
  private consultationPublicKeyPem: string | null = null;
  private consultationIsEncrypted = false;
  private cryptoService = inject(ConsultationCryptoService);
  private encryptionService = inject(EncryptionService);

  constructor(
    private route: ActivatedRoute,
    public navCtrl: NavController,
    private alertCtrl: AlertController,
    private toastCtrl: ToastController,
    private videoCallService: VideoCallService,
    private consultationService: ConsultationService,
    private wsService: ConsultationWebSocketService,
    private authService: AuthService,
    private incomingCallService: IncomingCallService,
    private cdr: ChangeDetectorRef
  ) {}

  ngOnInit(): void {
    const idParam = this.route.snapshot.paramMap.get('id');
    const type = this.route.snapshot.queryParamMap.get('type');
    const appointmentIdParam = this.route.snapshot.queryParamMap.get('appointmentId');
    const consultationIdParam = this.route.snapshot.queryParamMap.get('consultationId');

    if (idParam) {
      const id = parseInt(idParam, 10);

      if (appointmentIdParam) {
        this.consultationId = id;
        this.appointmentId = parseInt(appointmentIdParam, 10);
      } else if (type === 'consultation') {
        this.consultationId = id;
      } else {
        this.appointmentId = id;
        if (consultationIdParam) {
          this.consultationId = parseInt(consultationIdParam, 10);
        }
      }
    }

    this.loadCurrentUser();
    this.setupSubscriptions();
    this.setupWebSocketSubscriptions();

    // Prevent tab/window close during video call
    window.addEventListener('beforeunload', this.handleBeforeUnload);
  }

  private loadCurrentUser(): void {
    this.authService.currentUser$
      .pipe(takeUntil(this.destroy$))
      .subscribe(user => {
        if (user) {
          this.currentUser.set(user as User);
        } else {
          this.authService.getCurrentUser().subscribe();
        }
      });
  }

  private setupWebSocketSubscriptions(): void {
    // Only listen to `messageUpdated$` (backend event === 'message') — it is
    // the single source of truth for consultation messages. The legacy
    // `messages$` path appended without deduplication and caused sent
    // messages to appear twice.
    this.wsService.messageUpdated$
      .pipe(takeUntil(this.destroy$))
      .subscribe(async event => {
        if (!this.consultationId || event.consultation_id !== this.consultationId) {
          return;
        }

        if (event.state === 'created') {
          const exists = this.messages().some(m => m.id === event.data.id);
          if (!exists) {
            const newMessage = await this.mapMessage(
              event.data as ConsultationMessage,
            );
            this.messages.update(msgs => [...msgs, newMessage]);
            // Count it as unread only if it's not ours and the chat is closed.
            if (!newMessage.isCurrentUser && !this.showChat()) {
              this.unreadCount.update(n => n + 1);
            }
          }
        } else if (event.state === 'updated' || event.state === 'deleted') {
          this.loadMessages();
        }
      });
  }

  private async ensureConsultationKey(): Promise<void> {
    if (!this.consultationId) return;
    // Already resolved on a previous call: skip the network round-trip.
    if (this.consultationPrivateKey) return;
    try {
      const consultation = await firstValueFrom(
        this.consultationService.getConsultationById(this.consultationId),
      );
      this.consultationIsEncrypted = !!consultation?.is_encrypted;
      this.consultationPublicKeyPem = consultation?.public_key || null;
      const userId = this.currentUser()?.pk;
      if (consultation?.is_encrypted && userId) {
        this.consultationPrivateKey =
          await this.cryptoService.loadConsultationKey(consultation, userId);
      }
    } catch {
      // Best effort: if the consultation can't be loaded, messages will
      // simply remain encrypted. We don't block message loading.
    }
  }

  private async mapMessage(msg: ConsultationMessage): Promise<Message> {
    const currentUserId = this.currentUser()?.pk;
    const isSystem = !msg.created_by;
    const isCurrentUser = !isSystem && msg.created_by.id === currentUserId;
    const username = isSystem
      ? ''
      : isCurrentUser
        ? this.t.instant('videoConsultation.you')
        : `${msg.created_by.first_name} ${msg.created_by.last_name}`.trim();
    const decryptedContent = await this.cryptoService.decryptMessageContent(
      msg.content,
      msg.is_encrypted,
      this.consultationPrivateKey,
    );
    const { attachment, attachmentDecrypt } =
      await this.cryptoService.buildAttachmentDecryptor(
        msg,
        this.consultationPrivateKey,
      );
    return {
      id: msg.id,
      username,
      message: decryptedContent,
      timestamp: msg.created_at,
      isCurrentUser,
      isSystem,
      attachment,
      attachmentDecrypt,
      isEdited: msg.is_edited,
      updatedAt: msg.updated_at,
      deletedAt: msg.deleted_at,
    };
  }

  private async loadMessages(): Promise<void> {
    if (!this.consultationId) return;

    await this.ensureConsultationKey();
    this.currentPage = 1;
    this.consultationService.getConsultationMessagesPaginated(this.consultationId, 1)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: async (response) => {
          this.hasMore.set(!!response.next);
          const loadedMessages: Message[] = (
            await Promise.all(response.results.map(m => this.mapMessage(m)))
          ).reverse();
          this.messages.set(loadedMessages);
        },
        error: (err) => {
          if (err?.status === 404) {
            this.chatAvailable.set(false);
          } else {
            this.showToast(this.t.instant('videoConsultation.failedLoadMessages'));
          }
        }
      });
  }

  private handleBeforeUnload = (event: BeforeUnloadEvent): string | undefined => {
    if (this.phase() === 'in-call') {
      console.log('[VideoConsultationPage] beforeunload - User is in call, showing confirmation dialog');
      // Prevent the page from closing without confirmation
      event.preventDefault();
      // Modern browsers ignore custom messages, but we still need to return a value
      return event.returnValue = '';
    }
    return undefined;
  };

  ngOnDestroy(): void {
    console.log('[VideoConsultationPage] ngOnDestroy called - cleaning up and disconnecting');
    this.destroy$.next();
    this.destroy$.complete();
    this.videoCallService.disconnect();
    this.wsService.disconnect();
    // Media elements detach themselves via appMediaTrack's ngOnDestroy.
    this.stopDurationTimer();
    this.incomingCallService.clearActiveCall();
    window.removeEventListener('beforeunload', this.handleBeforeUnload);
  }

  private setupSubscriptions(): void {
    this.videoCallService.connectionStatus$
      .pipe(takeUntil(this.destroy$))
      .subscribe(status => {
        this.connectionStatus = status;
        if (status === 'connected' && !this.durationTimer) {
          this.startDurationTimer();
        }
        this.cdr.markForCheck();
      });

    this.videoCallService.removedByServer$
      .pipe(takeUntil(this.destroy$))
      .subscribe(() => this.handleServerRemoval());

    // Tracks are bound to their elements by appMediaTrack, so the subscriptions
    // only have to keep the fields up to date and let change detection run.
    this.videoCallService.localVideoTrack$
      .pipe(takeUntil(this.destroy$))
      .subscribe(track => {
        this.localVideoTrack = track;
        this.cdr.markForCheck();
      });

    this.videoCallService.participants$
      .pipe(takeUntil(this.destroy$))
      .subscribe(participants => {
        this.participants = participants;
        this.cdr.markForCheck();
      });

    this.videoCallService.isCameraEnabled$
      .pipe(takeUntil(this.destroy$))
      .subscribe(enabled => {
        this.isCameraEnabled = enabled;
        this.cdr.markForCheck();
      });

    this.videoCallService.isMicrophoneEnabled$
      .pipe(takeUntil(this.destroy$))
      .subscribe(enabled => {
        this.isMicrophoneEnabled = enabled;
        this.cdr.markForCheck();
      });

    this.videoCallService.isScreenShareEnabled$
      .pipe(takeUntil(this.destroy$))
      .subscribe(enabled => {
        this.isScreenShareEnabled = enabled;
        this.cdr.markForCheck();
      });

    this.videoCallService.localScreenShareTrack$
      .pipe(takeUntil(this.destroy$))
      .subscribe(track => {
        this.localScreenShareTrack = track;
        this.cdr.markForCheck();
      });

    this.videoCallService.error$
      .pipe(takeUntil(this.destroy$))
      .subscribe(error => {
        this.errorMessage = error;
        this.showToast(error);
        this.cdr.markForCheck();
      });
  }

  async joinRoom(): Promise<void> {
    this.isLoading = true;
    this.errorMessage = '';
    this.cdr.markForCheck();

    try {
      let config: VideoCallConfig | undefined;

      if (this.appointmentId) {
        config = await this.consultationService
          .joinAppointment(this.appointmentId)
          .toPromise();
      } else if (this.consultationId) {
        config = await this.consultationService
          .joinConsultation(this.consultationId)
          .toPromise();
      } else {
        throw new Error('Either consultationId or appointmentId is required');
      }

      if (!config) {
        throw new Error('Failed to get video call configuration');
      }

      await this.videoCallService.connect(config);

      // Enable camera/microphone separately - don't fail the whole join if camera is unavailable
      try {
        await this.videoCallService.enableCamera(true);
      } catch {
        // Camera not available, continue without it
      }
      try {
        await this.videoCallService.enableMicrophone(true);
      } catch {
        // Microphone not available, continue without it
      }

      this.phase.set('in-call');
      if (this.appointmentId) {
        this.incomingCallService.setActiveCall(this.appointmentId);
      }
      this.showToast(this.t.instant('videoConsultation.connectedToConsultation'));

      if (this.consultationId) {
        this.loadMessages();
        this.wsService.connect(this.consultationId);
      }
    } catch (error) {
      this.errorMessage = this.describeJoinError(error);
      this.showToast(this.errorMessage);
    } finally {
      this.isLoading = false;
      this.cdr.markForCheck();
    }
  }

  /**
   * A join can legitimately be refused (too early, consultation closed, no
   * longer a participant): an invitation link opens the lobby without
   * re-checking any of it. The backend explains why in `detail`, so show that
   * rather than a generic failure the patient cannot act on.
   */
  private describeJoinError(error: unknown): string {
    const detail = (error as { error?: { detail?: string } })?.error?.detail;
    if (typeof detail === 'string' && detail) {
      return detail;
    }
    if (error instanceof Error) {
      return error.message;
    }
    return this.t.instant('videoConsultation.failedJoin');
  }

  onLobbyClose(): void {
    this.navCtrl.back();
  }

  async onJoinFromLobby(settings: IPreJoinSettings): Promise<void> {
    this.phase.set('connecting');
    this.isLoading = true;
    this.errorMessage = '';
    this.cdr.markForCheck();

    try {
      let config: VideoCallConfig | undefined;

      if (this.appointmentId) {
        config = await this.consultationService
          .joinAppointment(this.appointmentId)
          .toPromise();
      } else if (this.consultationId) {
        config = await this.consultationService
          .joinConsultation(this.consultationId)
          .toPromise();
      } else {
        throw new Error('Either consultationId or appointmentId is required');
      }

      if (!config) {
        throw new Error('Failed to get video call configuration');
      }

      const deviceIds: { camera?: string; microphone?: string } = {};
      if (settings.cameraDeviceId) {
        deviceIds.camera = settings.cameraDeviceId;
      }
      if (settings.microphoneDeviceId) {
        deviceIds.microphone = settings.microphoneDeviceId;
      }

      await this.videoCallService.connect(config, deviceIds);

      // Enable camera/microphone separately - don't fail the whole join if camera is unavailable
      try {
        await this.videoCallService.enableCamera(settings.cameraEnabled);
      } catch {
        // Camera not available, continue without it
      }
      try {
        await this.videoCallService.enableMicrophone(settings.microphoneEnabled);
      } catch {
        // Microphone not available, continue without it
      }

      if (settings.speakerDeviceId) {
        try {
          await this.videoCallService.switchSpeaker(settings.speakerDeviceId);
        } catch {
          // Output device selection is unsupported on some browsers, never a join blocker
        }
      }

      this.phase.set('in-call');
      if (this.appointmentId) {
        this.incomingCallService.setActiveCall(this.appointmentId);
      }
      this.cdr.markForCheck();
      this.showToast(this.t.instant('videoConsultation.connectedToConsultation'));

      if (this.consultationId) {
        this.loadMessages();
        this.wsService.connect(this.consultationId);
      }
    } catch (error) {
      this.errorMessage = this.describeJoinError(error);
      this.showToast(this.errorMessage);
      this.phase.set('lobby');
    } finally {
      this.isLoading = false;
      this.cdr.markForCheck();
    }
  }

  private startDurationTimer(): void {
    this.durationTimer = interval(1000)
      .pipe(takeUntil(this.destroy$))
      .subscribe(() => {
        this.callDuration++;
        this.formattedDuration = this.formatDuration(this.callDuration);
        this.cdr.markForCheck();
      });
  }

  private stopDurationTimer(): void {
    if (this.durationTimer) {
      this.durationTimer.unsubscribe();
      this.durationTimer = null;
    }
  }

  private formatDuration(seconds: number): string {
    const hrs = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;

    if (hrs > 0) {
      return `${hrs.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    }
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  }

  async toggleCamera(): Promise<void> {
    try {
      await this.videoCallService.toggleCamera();
    } catch (error) {
      this.showToast(this.t.instant('videoConsultation.failedToggleCamera'));
    }
  }

  async toggleMicrophone(): Promise<void> {
    try {
      await this.videoCallService.toggleMicrophone();
    } catch (error) {
      this.showToast(this.t.instant('videoConsultation.failedToggleMic'));
    }
  }

  async toggleScreenShare(): Promise<void> {
    try {
      await this.videoCallService.toggleScreenShare();
    } catch (error) {
      this.showToast(this.t.instant('videoConsultation.failedToggleScreen'));
    }
  }

  switchCamera(): void {
    this.showToast(this.t.instant('videoConsultation.switchingCamera'));
  }

  async endCall(): Promise<void> {
    const alert = await this.alertCtrl.create({
      header: this.t.instant('videoConsultation.endCallHeader'),
      message: this.t.instant('videoConsultation.endCallMessage'),
      buttons: [
        {
          text: this.t.instant('common.cancel'),
          role: 'cancel'
        },
        {
          text: this.t.instant('videoConsultation.endCallButton'),
          role: 'destructive',
          handler: () => {
            this.performEndCall();
          }
        }
      ]
    });

    await alert.present();
  }

  private async performEndCall(): Promise<void> {
    this.phase.set('lobby'); // Prevent the guard from triggering on navigation

    // Notifier le backend du départ
    if (this.appointmentId) {
      try {
        await firstValueFrom(
          this.consultationService.leaveAppointment(this.appointmentId)
        );
      } catch (error) {
        console.error('Failed to notify leave:', error);
        // Continuer la déconnexion même en cas d'erreur
      }
    }

    await this.videoCallService.disconnect();
    this.stopDurationTimer();
    this.incomingCallService.clearActiveCall();

    // Navigate to home page
    this.navCtrl.navigateRoot('/home');
  }

  /**
   * The media server removed us from the call (typically because the
   * practitioner closed the consultation). Tear the call down and navigate
   * home without prompting, so the patient isn't left on a dead screen.
   */
  private async handleServerRemoval(): Promise<void> {
    this.phase.set('lobby'); // Prevent the leave guard from triggering on navigation
    await this.videoCallService.disconnect();
    this.stopDurationTimer();
    this.incomingCallService.clearActiveCall();
    await this.showToast(this.t.instant('videoCall.callEndedByServer'));
    this.navCtrl.navigateRoot('/home');
  }

  openChat(): void {
    this.showChat.update(v => !v);
    // Opening the chat clears the unread badge.
    if (this.showChat()) {
      this.unreadCount.set(0);
    }
  }

  async onSendMessage(data: SendMessageData): Promise<void> {
    if (!this.consultationId) return;

    let content = data.content || '';
    let attachment = data.attachment;
    let isEncrypted = false;
    let encryptedAttachmentMetadata: string | null = null;

    if (this.consultationIsEncrypted && this.consultationPublicKeyPem) {
      const consultPub = this.consultationPublicKeyPem;
      isEncrypted = true;
      if (data.content) {
        content = await this.encryptionService.encryptString(
          data.content,
          consultPub,
        );
      }
      if (data.attachment) {
        const { blob: encryptedBlob, wrappedKey } =
          await this.encryptionService.encryptBlob(data.attachment, consultPub);
        attachment = new File(
          [encryptedBlob],
          data.attachment.name,
          { type: 'application/octet-stream' },
        );
        encryptedAttachmentMetadata =
          await this.encryptionService.encryptAttachmentMetadata(
            {
              file_name: data.attachment.name,
              mime_type: data.attachment.type,
              wrapped_key: wrappedKey,
            },
            consultPub,
          );
      }
    }

    // No optimistic insert: the WebSocket `messageUpdated$` subscription
    // adds the message once the backend echoes it back, which keeps the
    // patient and practitioner views in sync without duplicates.
    this.consultationService.sendConsultationMessage(
      this.consultationId,
      content,
      attachment,
      {
        is_encrypted: isEncrypted || undefined,
        encrypted_attachment_metadata: encryptedAttachmentMetadata,
      },
    )
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        error: () => {
          this.showToast(this.t.instant('videoConsultation.failedSend'));
        }
      });
  }

  onEditMessage(data: EditMessageData): void {
    if (!this.consultationId) return;

    this.consultationService.updateConsultationMessage(data.messageId, data.content)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (updatedMessage) => {
          this.messages.update(msgs =>
            msgs.map(m => m.id === data.messageId ? {
              ...m,
              message: updatedMessage.content || '',
              isEdited: updatedMessage.is_edited,
              updatedAt: updatedMessage.updated_at,
            } : m)
          );
          this.showToast(this.t.instant('videoConsultation.messageUpdated'));
        },
        error: () => {
          this.showToast(this.t.instant('videoConsultation.failedUpdate'));
        }
      });
  }

  onDeleteMessage(data: DeleteMessageData): void {
    this.consultationService.deleteConsultationMessage(data.messageId)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (deletedMessage) => {
          this.messages.update(msgs =>
            msgs.map(m => m.id === data.messageId ? {
              ...m,
              message: '',
              attachment: null,
              deletedAt: deletedMessage.deleted_at,
            } : m)
          );
          this.showToast(this.t.instant('videoConsultation.messageDeleted'));
        },
        error: () => {
          this.showToast(this.t.instant('videoConsultation.failedDelete'));
        }
      });
  }

  onLoadMore(): void {
    if (!this.consultationId || this.isLoadingMore() || !this.hasMore()) return;

    this.isLoadingMore.set(true);
    this.currentPage++;

    this.consultationService.getConsultationMessagesPaginated(this.consultationId, this.currentPage)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: async (response) => {
          this.hasMore.set(!!response.next);
          const olderMessages: Message[] = (
            await Promise.all(response.results.map(m => this.mapMessage(m)))
          ).reverse();
          this.messages.update(msgs => [...olderMessages, ...msgs]);
          this.isLoadingMore.set(false);
        },
        error: () => {
          this.currentPage--;
          this.isLoadingMore.set(false);
          this.showToast(this.t.instant('videoConsultation.failedLoadMore'));
        }
      });
  }

  async showToast(message: string): Promise<void> {
    const toast = await this.toastCtrl.create({
      message,
      duration: 2000,
      position: 'top'
    });
    toast.present();
  }

  getCallStateMessage(): string {
    switch (this.connectionStatus) {
      case 'connecting': return this.t.instant('videoConsultation.connecting');
      case 'reconnecting': return this.t.instant('videoConsultation.reconnecting');
      case 'disconnected': return this.t.instant('videoConsultation.disconnected');
      case 'failed': return this.t.instant('videoConsultation.connectionFailedStatus');
      default: return '';
    }
  }

  getParticipantsArray(): ParticipantInfo[] {
    return Array.from(this.participants.values());
  }

  getRemoteParticipant(): ParticipantInfo | null {
    const participantsArray = this.getParticipantsArray();
    return participantsArray.length > 0 ? participantsArray[0] : null;
  }

  getTotalTileCount(): number {
    const participants = this.getParticipantsArray();
    const participantCount = participants.length;
    const screenShareCount = participants.filter(p => p.isScreenShareEnabled && p.screenShareTrack).length;
    const localScreenShareCount = this.isScreenShareEnabled && this.localScreenShareTrack ? 1 : 0;
    return 1 + localScreenShareCount + (participantCount > 0 ? participantCount + screenShareCount : 1);
  }

  getScreenSharingParticipant(): ParticipantInfo | null {
    for (const participant of this.participants.values()) {
      if (participant.isScreenShareEnabled && participant.screenShareTrack) {
        return participant;
      }
    }
    return null;
  }

  hasActiveScreenShare(): boolean {
    return (
      (this.isScreenShareEnabled && !!this.localScreenShareTrack) ||
      this.getScreenSharingParticipant() !== null
    );
  }
}
