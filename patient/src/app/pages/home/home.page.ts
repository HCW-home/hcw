import { Component, OnInit, OnDestroy, signal, computed, inject, HostListener } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute } from '@angular/router';
import {
  IonIcon,
  IonContent,
  IonRefresher,
  IonRefresherContent,
  IonSpinner,
  NavController,
  ToastController,
  AlertController
} from '@ionic/angular/standalone';
import { TranslatePipe } from '@ngx-translate/core';
import { Subject, takeUntil } from 'rxjs';
import { AuthService } from '../../core/services/auth.service';
import { ConsultationService } from '../../core/services/consultation.service';
import { ConsultationWebSocketService } from '../../core/services/consultation-websocket.service';
import { EncryptionService } from '../../core/services/encryption.service';
import { UserWebSocketService } from '../../core/services/user-websocket.service';
import { WebSocketState } from '../../core/models/websocket.model';
import { User } from '../../core/models/user.model';
import { AppHeaderComponent } from '../../shared/app-header/app-header.component';
import { AppFooterComponent } from '../../shared/app-footer/app-footer.component';
import { ConsultationRequest, Consultation, ConsultationMessage, Speciality, Appointment } from '../../core/models/consultation.model';
import { TranslationService } from '../../core/services/translation.service';
import { LocalDatePipe } from '../../shared/pipes/local-date.pipe';
import { AppointmentInfoComponent } from '../../shared/components/appointment-info/appointment-info';
import { ConsultationInfoComponent } from '../../shared/components/consultation-info/consultation-info';
import { MessageListComponent, Message, SendMessageData, EditMessageData, DeleteMessageData } from '../../shared/components/message-list/message-list';

interface RequestStatus {
  label: string;
  color: 'warning' | 'info' | 'primary' | 'success' | 'muted' | 'danger';
}

@Component({
  selector: 'app-home',
  templateUrl: './home.page.html',
  styleUrls: ['./home.page.scss'],
  standalone: true,
  imports: [
    CommonModule,
    LocalDatePipe,
    IonIcon,
    IonContent,
    IonRefresher,
    IonRefresherContent,
    IonSpinner,
    AppHeaderComponent,
    AppFooterComponent,
    TranslatePipe,
    AppointmentInfoComponent,
    ConsultationInfoComponent,
    MessageListComponent,
  ]
})
export class HomePage implements OnInit, OnDestroy {
  private destroy$ = new Subject<void>();
  private t = inject(TranslationService);
  private encryptionService = inject(EncryptionService);

  private chatConsultationPrivateKey: CryptoKey | null = null;
  private chatConsultationPublicKey: string | null = null;

  currentUser = signal<User | null>(null);
  hasReasons = signal(false);
  nextAppointment = signal<Appointment | null>(null);
  requests = signal<ConsultationRequest[]>([]);
  consultations = signal<Consultation[]>([]);
  appointments = signal<Appointment[]>([]);
  isLoading = signal(false);
  appointmentEarlyJoinMinutes = 5; // Default value
  highlightedRequestId = signal<number | null>(null);

  totalRequests = computed(() => this.requests().length);
  totalConsultations = computed(() => this.consultations().length);
  totalAppointments = computed(() => this.appointments().length);
  hasNoItems = computed(() => this.totalRequests() === 0 && this.totalConsultations() === 0 && this.totalAppointments() === 0);

  // Chat inline state
  expandedConsultationId = signal<number | null>(null);
  chatMessages = signal<Message[]>([]);
  isChatConnected = signal(false);
  isChatLoadingMore = signal(false);
  chatHasMore = signal(true);
  private chatCurrentPage = 1;
  private pendingOpenChatId: number | null = null;

  // Unread counts per consultation
  private unreadCounts = signal<Map<number, number>>(new Map());
  private lastReadAtMap = new Map<number, string | null>();
  chatUnreadSeparator = signal<string | null>(null);

  constructor(
    private navCtrl: NavController,
    private route: ActivatedRoute,
    private authService: AuthService,
    private consultationService: ConsultationService,
    private toastController: ToastController,
    private alertController: AlertController,
    private userWsService: UserWebSocketService,
    private chatWsService: ConsultationWebSocketService
  ) {}

  private async showError(message: string): Promise<void> {
    const toast = await this.toastController.create({
      message,
      duration: 3000,
      position: 'bottom',
      color: 'danger'
    });
    await toast.present();
  }

  @HostListener('document:click', ['$event'])
  onDocumentClick(event: MouseEvent): void {
    if (!this.expandedConsultationId()) return;
    const target = event.target as HTMLElement;
    if (!target.closest('.timeline-item.expanded')) {
      this.closeChat();
    }
  }

  ngOnInit(): void {
    this.loadUserData();
    this.loadDashboard();
    this.listenToWebSocketChanges();
    this.loadConfig();
    this.handleQueryParams();
    this.setupChatWebSocket();
  }

  handleQueryParams(): void {
    this.route.queryParams
      .pipe(takeUntil(this.destroy$))
      .subscribe(params => {
        const participantId = params['participantId'];
        const join = params['join'];
        const highlightRequest = params['highlightRequest'];
        const openChat = params['openChat'];

        if (openChat) {
          this.navCtrl.navigateRoot('/home', { replaceUrl: true });
          this.pendingOpenChatId = Number(openChat);
        }

        if (highlightRequest) {
          this.highlightedRequestId.set(Number(highlightRequest));
          // Clear the highlight after 3 seconds
          setTimeout(() => {
            this.highlightedRequestId.set(null);
          }, 3000);
          // Clear query params to avoid re-triggering on refresh
          this.navCtrl.navigateRoot('/home', { replaceUrl: true });
        }

        if (participantId && join === 'true') {
          // Clear query params to avoid re-triggering
          this.navCtrl.navigateRoot('/home', { replaceUrl: true });

          // Fetch participant to get appointment ID
          this.consultationService.getParticipantById(Number(participantId))
            .pipe(takeUntil(this.destroy$))
            .subscribe({
              next: (participant) => {
                if (participant.appointment) {
                  this.tryJoinAppointment(participant.appointment);
                } else {
                  this.showError(this.t.instant('home.appointmentNotFound'));
                }
              },
              error: (error) => {
                this.showError(error?.error?.detail || this.t.instant('home.failedToLoadParticipant'));
              }
            });
        }
      });
  }

  loadConfig(): void {
    this.authService.getConfig()
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (config) => {
          if (config.appointment_early_join_minutes) {
            this.appointmentEarlyJoinMinutes = config.appointment_early_join_minutes;
          }
        },
        error: () => {
          // Use default value on error
        }
      });
  }

  ngOnDestroy(): void {
    this.chatWsService.disconnect();
    this.destroy$.next();
    this.destroy$.complete();
  }

  ionViewWillEnter(): void {
    this.loadDashboard();
  }

  loadUserData(): void {
    this.authService.currentUser$
      .pipe(takeUntil(this.destroy$))
      .subscribe(user => {
        this.currentUser.set(user);
      });
  }

  loadDashboard(): void {
    this.isLoading.set(true);
    this.refreshDashboard();
  }

  private refreshDashboard(): void {
    this.consultationService.getDashboard()
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (response) => {
          this.hasReasons.set(response.has_reasons);
          this.nextAppointment.set(response.next_appointment);
          this.requests.set(response.requests);
          this.consultations.set(response.consultations);
          this.appointments.set(response.appointments);
          this.isLoading.set(false);
          this.updateUnreadCountsFromData(response);

          if (this.pendingOpenChatId) {
            const chatId = this.pendingOpenChatId;
            this.pendingOpenChatId = null;
            setTimeout(() => this.openChat(chatId), 100);
          }
        },
        error: (error) => {
          this.showError(error?.error?.detail || this.t.instant('home.failedToLoad'));
          this.isLoading.set(false);
        }
      });
  }

  private listenToWebSocketChanges(): void {
    this.userWsService.appointmentChanged$
      .pipe(takeUntil(this.destroy$))
      .subscribe(() => {
        this.refreshDashboard();
      });

    this.userWsService.consultationChanged$
      .pipe(takeUntil(this.destroy$))
      .subscribe(() => {
        this.refreshDashboard();
      });

    this.userWsService.consultationMessage$
      .pipe(takeUntil(this.destroy$))
      .subscribe(event => {
        const consultationId = event.consultation_id;
        if (event.state === 'created' && consultationId !== this.expandedConsultationId()) {
          const user = this.currentUser();
          const senderId = event.data?.created_by?.id;
          if (senderId && senderId !== user?.id && senderId !== user?.pk) {
            this.incrementUnreadCount(consultationId);
          }
        }
      });
  }

  refreshData(event: { target: { complete: () => void } }): void {
    this.consultationService.getDashboard()
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (response) => {
          this.hasReasons.set(response.has_reasons);
          this.nextAppointment.set(response.next_appointment);
          this.requests.set(response.requests);
          this.consultations.set(response.consultations);
          this.appointments.set(response.appointments);
          event.target.complete();
        },
        error: (error) => {
          this.showError(error?.error?.detail || this.t.instant('home.failedToLoad'));
          event.target.complete();
        }
      });
  }

  goToNewRequest(): void {
    this.navCtrl.navigateForward('/new-request');
  }

  getStatusConfig(status: string | undefined): RequestStatus {
    const normalizedStatus = (status || 'Requested').toLowerCase();
    const statusMap: Record<string, RequestStatus> = {
      'requested': { label: this.t.instant('home.statusPending'), color: 'warning' },
      'accepted': { label: this.t.instant('home.statusAccepted'), color: 'info' },
      'scheduled': { label: this.t.instant('home.statusScheduled'), color: 'primary' },
      'cancelled': { label: this.t.instant('home.statusCancelled'), color: 'danger' },
      'refused': { label: this.t.instant('home.statusRefused'), color: 'danger' }
    };
    return statusMap[normalizedStatus] || statusMap['requested'];
  }

  hasAppointment(request: ConsultationRequest): boolean {
    return !!request.appointment;
  }

  hasConsultation(request: ConsultationRequest): boolean {
    return !!request.consultation;
  }

  getReasonName(request: ConsultationRequest): string {
    if (typeof request.reason === 'object' && request.reason) {
      return request.reason.name;
    }
    return this.t.instant('home.consultation');
  }

  getSpecialityName(request: ConsultationRequest): string {
    if (typeof request.reason === 'object' && request.reason) {
      const speciality = request.reason.speciality;
      if (typeof speciality === 'object' && speciality) {
        return (speciality as Speciality).name;
      }
    }
    return '';
  }

  getDoctorName(request: ConsultationRequest): string {
    if (request.appointment?.participants) {
      const doctor = request.appointment.participants.find(p => p.user && p.user.id !== request.created_by?.id);
      if (doctor?.user) {
        return `${doctor.user.first_name} ${doctor.user.last_name}`;
      }
    }
    if (typeof request.expected_with === 'object' && request.expected_with) {
      const user = request.expected_with as { first_name?: string; last_name?: string };
      return `${user.first_name || ''} ${user.last_name || ''}`.trim();
    }
    return '';
  }

  getAppointmentTypeIcon(request: ConsultationRequest): string {
    return request.appointment?.type === 'online' ? 'videocam-outline' : 'location-outline';
  }

  getAppointmentTypeLabel(request: ConsultationRequest): string {
    return request.appointment?.type === 'online' ? this.t.instant('common.video') : this.t.instant('common.inPerson');
  }

  isStatusRequested(request: ConsultationRequest): boolean {
    return request.status?.toLowerCase() === 'requested';
  }

  isStatusAccepted(request: ConsultationRequest): boolean {
    return request.status?.toLowerCase() === 'accepted';
  }

  isStatusRefused(request: ConsultationRequest): boolean {
    return request.status?.toLowerCase() === 'refused';
  }

  isStatusCancelled(request: ConsultationRequest): boolean {
    return request.status?.toLowerCase() === 'cancelled';
  }

  isRequestHighlighted(request: ConsultationRequest): boolean {
    const highlightId = this.highlightedRequestId();
    if (!highlightId) return false;
    const requestId = (request as any).pk ?? (request as any).id;
    return requestId === highlightId;
  }

  getConsultationDoctorName(consultation: Consultation): string {
    if (consultation.owned_by) {
      return `${consultation.owned_by.first_name} ${consultation.owned_by.last_name}`;
    }
    return '';
  }

  getConsultationReasonName(consultation: Consultation): string {
    if (consultation.title) {
      return consultation.title;
    }
    return this.t.instant('home.consultation');
  }

  viewConsultationDetails(consultation: Consultation): void {
    this.openChat(consultation.id);
  }

  getConsultationStatusConfig(status: string): { label: string; color: 'warning' | 'info' | 'primary' | 'success' | 'muted' } {
    const normalizedStatus = (status || 'REQUESTED').toLowerCase();
    const statusMap: Record<string, { label: string; color: 'warning' | 'info' | 'primary' | 'success' | 'muted' }> = {
      'requested': { label: this.t.instant('home.statusRequested'), color: 'warning' },
      'active': { label: this.t.instant('home.statusActive'), color: 'success' },
      'closed': { label: this.t.instant('home.statusClosed'), color: 'muted' },
      'cancelled': { label: this.t.instant('home.statusCancelled'), color: 'muted' }
    };
    return statusMap[normalizedStatus] || statusMap['requested'];
  }

  getAppointmentStatusConfig(status: string): { label: string; color: 'warning' | 'info' | 'primary' | 'success' | 'muted' } {
    const normalizedStatus = (status || 'draft').toLowerCase();
    const statusMap: Record<string, { label: string; color: 'warning' | 'info' | 'primary' | 'success' | 'muted' }> = {
      'draft': { label: this.t.instant('home.statusDraft'), color: 'warning' },
      'scheduled': { label: this.t.instant('home.statusScheduled'), color: 'primary' },
      'cancelled': { label: this.t.instant('home.statusCancelled'), color: 'muted' }
    };
    return statusMap[normalizedStatus] || statusMap['draft'];
  }

  getAppointmentDoctorName(appointment: Appointment): string {
    const user = this.currentUser();
    const currentUserIds = [user?.id, user?.pk].filter(Boolean);
    if (appointment.participants) {
      const doctor = appointment.participants.find(p => p.user && !currentUserIds.includes(p.user.id));
      if (doctor?.user) {
        return `${doctor.user.first_name} ${doctor.user.last_name}`;
      }
    }
    return '';
  }

  getAppointmentIcon(appointment: Appointment): string {
    return appointment.type === 'online' ? 'videocam-outline' : 'location-outline';
  }

  getAppointmentTypeText(appointment: Appointment): string {
    return appointment.type === 'online' ? this.t.instant('common.video') : this.t.instant('common.inPerson');
  }


  getNextAppointmentDoctorName(): string {
    const appt = this.nextAppointment();
    if (!appt) return '';
    return this.getAppointmentDoctorName(appt);
  }

  getNextAppointmentDoctorSpeciality(): string {
    const appt = this.nextAppointment();
    if (!appt?.participants) return '';
    const user = this.currentUser();
    const currentUserIds = [user?.id, user?.pk].filter(Boolean);
    const doctor = appt.participants.find(p => p.user && !currentUserIds.includes(p.user.id));
    if (doctor?.user?.specialities?.length) {
      return doctor.user.specialities.map(s => s.name).join(', ');
    }
    return '';
  }

  joinNextAppointment(): void {
    const appt = this.nextAppointment();
    if (appt) {
      this.tryJoinAppointment(appt);
    }
  }

  viewConsultationFromRequest(request: ConsultationRequest): void {
    if (request.consultation?.id) {
      this.openChat(request.consultation.id);
    }
  }

  joinAppointment(appointment: Appointment): void {
    this.tryJoinAppointment(appointment);
  }

  private async tryJoinAppointment(appointment: Appointment): Promise<void> {
    const now = new Date();
    const scheduledAt = new Date(appointment.scheduled_at);
    const earliestJoin = new Date(scheduledAt.getTime() - this.appointmentEarlyJoinMinutes * 60 * 1000);

    if (now < earliestJoin) {
      const time = scheduledAt.toLocaleString([], { year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' });
      const alert = await this.alertController.create({
        header: this.t.instant('home.tooEarlyTitle'),
        message: this.t.instant('home.tooEarlyMessage', { time, minutes: this.appointmentEarlyJoinMinutes.toString() }),
        buttons: ['OK']
      });
      await alert.present();
      return;
    }

    this.navCtrl.navigateForward(`/consultation/${appointment.consultation_id || 0}/video`, {
      queryParams: { appointmentId: appointment.id }
    });
  }

  // --- Inline chat ---

  private setupChatWebSocket(): void {
    this.chatWsService.state$
      .pipe(takeUntil(this.destroy$))
      .subscribe(state => {
        this.isChatConnected.set(state === WebSocketState.CONNECTED);
      });

    this.chatWsService.messageUpdated$
      .pipe(takeUntil(this.destroy$))
      .subscribe(async event => {
        if (!this.expandedConsultationId() || event.consultation_id !== this.expandedConsultationId()) return;

        if (event.state === 'created') {
          const exists = this.chatMessages().some(m => m.id === event.data.id);
          if (!exists) {
            const user = this.currentUser();
            const isSystem = !event.data.created_by;
            const isCurrentUser = isSystem ? false : (user?.pk === event.data.created_by?.id || user?.id === event.data.created_by?.id);
            const decryptedContent = await this.decryptIfNeeded(
              event.data.content,
              event.data.is_encrypted,
            );
            const { attachment, attachmentDecrypt } =
              await this.buildAttachmentDecryptor(
                event.data as ConsultationMessage,
              );
            const newMessage: Message = {
              id: event.data.id,
              username: isSystem ? '' : `${event.data.created_by.first_name} ${event.data.created_by.last_name}`,
              message: decryptedContent,
              timestamp: event.data.created_at,
              isCurrentUser,
              isSystem,
              attachment,
              attachmentDecrypt,
              isEdited: event.data.is_edited,
              updatedAt: event.data.updated_at,
            };
            this.chatMessages.update(msgs => [...msgs, newMessage]);
            // Chat is open — mark as read and clear separator
            if (!isCurrentUser && !isSystem) {
              this.chatUnreadSeparator.set(null);
              this.consultationService.markConsultationRead(this.expandedConsultationId()!)
                .pipe(takeUntil(this.destroy$))
                .subscribe();
            }
          }
        } else if (event.state === 'updated' || event.state === 'deleted') {
          this.loadChatMessages();
        }
      });
  }

  private findLastReadAt(consultationId: number): string | null {
    // Local override takes priority (set when closing chat)
    if (this.lastReadAtMap.has(consultationId)) {
      return this.lastReadAtMap.get(consultationId) || null;
    }
    for (const req of this.requests()) {
      if (req.consultation?.id === consultationId) {
        return req.consultation.last_read_at || null;
      }
    }
    for (const c of this.consultations()) {
      if (c.id === consultationId) {
        return c.last_read_at || null;
      }
    }
    return null;
  }

  private updateLocalLastReadAt(consultationId: number, timestamp: string): void {
    this.lastReadAtMap.set(consultationId, timestamp);
  }

  openChat(consultationId: number): void {
    if (this.expandedConsultationId() === consultationId) {
      this.closeChat();
      return;
    }
    const lastReadAt = this.findLastReadAt(consultationId);
    console.log('[openChat] consultationId:', consultationId, 'lastReadAt:', lastReadAt);
    this.chatUnreadSeparator.set(lastReadAt);
    this.expandedConsultationId.set(consultationId);
    this.chatMessages.set([]);
    this.chatCurrentPage = 1;
    this.chatHasMore.set(true);
    this.chatWsService.connect(consultationId);
    this.loadChatMessages();
    this.clearUnreadCount(consultationId);
    this.consultationService.markConsultationRead(consultationId)
      .pipe(takeUntil(this.destroy$))
      .subscribe();

    // Scroll so the chat input is visible and focus it
    setTimeout(() => {
      const chatEl = document.querySelector('.timeline-item.expanded .inline-chat');
      if (chatEl) {
        chatEl.scrollIntoView({ behavior: 'smooth', block: 'end' });
        const input = chatEl.querySelector<HTMLInputElement>('.message-input');
        if (input) {
          input.focus();
        }
      }
    }, 350);
  }

  closeChat(): void {
    // Update last_read_at locally so the separator works correctly on next open
    const id = this.expandedConsultationId();
    if (id) {
      this.updateLocalLastReadAt(id, new Date().toISOString());
    }
    this.chatWsService.disconnect();
    this.expandedConsultationId.set(null);
    this.chatMessages.set([]);
    this.chatUnreadSeparator.set(null);
  }

  isConsultationExpanded(consultationId: number): boolean {
    return this.expandedConsultationId() === consultationId;
  }

  private async ensureChatConsultationKey(consultation: Consultation | undefined): Promise<void> {
    // Tree navigation: the consultation has its own RSA keypair. Each
    // authorized recipient (user or queue) holds the consultation private
    // key wrapped in a ConsultationKey row. Find any row I can unwrap
    // (direct or via a queue I belong to), import as non-extractable, and
    // cache it for message decrypt + store the consultation pubkey for
    // outgoing message encrypt.
    this.chatConsultationPrivateKey = null;
    this.chatConsultationPublicKey = consultation?.public_key || null;
    if (!consultation?.is_encrypted) {
      return;
    }
    const userId = this.currentUser()?.pk;
    if (!userId) return;
    const privateKey = await this.encryptionService.getLocalPrivateKey(userId);
    if (!privateKey) return;

    for (const key of consultation.keys || []) {
      try {
        let consultPrivPem: string | null = null;
        if (key.user_id === userId) {
          const buf = await this.encryptionService.rsaEnvelopeDecrypt(
            key.encrypted_private_key,
            privateKey,
          );
          consultPrivPem = new TextDecoder().decode(buf);
        } else if (key.queue_id && key.queue_membership_envelope) {
          const queuePemBuf = await this.encryptionService.rsaEnvelopeDecrypt(
            key.queue_membership_envelope,
            privateKey,
          );
          const queuePem = new TextDecoder().decode(queuePemBuf);
          const queuePrivateKey =
            await this.encryptionService.importPrivateKey(queuePem);
          const consultPrivBuf = await this.encryptionService.rsaEnvelopeDecrypt(
            key.encrypted_private_key,
            queuePrivateKey,
          );
          consultPrivPem = new TextDecoder().decode(consultPrivBuf);
        }
        if (!consultPrivPem) continue;

        this.chatConsultationPrivateKey =
          await this.encryptionService.importPrivateKey(consultPrivPem);
        return;
      } catch (err) {
        console.warn('Consultation key unwrap failed for entry', err);
      }
    }
  }

  private async decryptIfNeeded(content: string | null, isEncrypted?: boolean): Promise<string> {
    if (!isEncrypted || !content || !this.chatConsultationPrivateKey) {
      return content || '';
    }
    try {
      return await this.encryptionService.decryptString(
        content,
        this.chatConsultationPrivateKey,
      );
    } catch {
      return '[decryption failed]';
    }
  }

  private async buildAttachmentDecryptor(msg: ConsultationMessage): Promise<{
    attachment: ConsultationMessage['attachment'];
    attachmentDecrypt?: (encryptedBlob: Blob) => Promise<Blob>;
  }> {
    if (
      !msg.is_encrypted
      || !msg.attachment
      || !msg.encrypted_attachment_metadata
      || !this.chatConsultationPrivateKey
    ) {
      return { attachment: msg.attachment };
    }
    try {
      const metadata = await this.encryptionService.decryptAttachmentMetadata(
        msg.encrypted_attachment_metadata,
        this.chatConsultationPrivateKey,
      );
      const privateKey = this.chatConsultationPrivateKey;
      const encryptionService = this.encryptionService;
      return {
        attachment: {
          file_name: metadata.file_name,
          mime_type: metadata.mime_type,
        } as ConsultationMessage['attachment'],
        attachmentDecrypt: async (encryptedBlob: Blob): Promise<Blob> => {
          const decrypted = await encryptionService.decryptBlob(
            encryptedBlob,
            privateKey,
            metadata,
          );
          return decrypted.blob;
        },
      };
    } catch (err) {
      console.warn('Failed to decrypt attachment metadata', err);
      return { attachment: msg.attachment };
    }
  }

  private async loadChatMessages(): Promise<void> {
    const id = this.expandedConsultationId();
    if (!id) return;

    const consultation = this.consultations().find(c => c.id === id);
    await this.ensureChatConsultationKey(consultation);

    this.chatCurrentPage = 1;
    this.consultationService.getConsultationMessagesPaginated(id, 1)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: async response => {
          this.chatHasMore.set(!!response.next);
          const currentUserId = this.currentUser()?.pk;
          const msgs: Message[] = await Promise.all(
            response.results.map(async msg => {
              const isSystem = !msg.created_by;
              const isCurrentUser = isSystem ? false : msg.created_by.id === currentUserId;
              const decryptedMessage = await this.decryptIfNeeded(msg.content, msg.is_encrypted);
              const { attachment, attachmentDecrypt } =
                await this.buildAttachmentDecryptor(msg);
              return {
                id: msg.id,
                username: isSystem ? '' : isCurrentUser
                  ? this.t.instant('consultationDetail.you')
                  : `${msg.created_by.first_name} ${msg.created_by.last_name}`.trim(),
                message: decryptedMessage,
                timestamp: msg.created_at,
                isCurrentUser,
                isSystem,
                attachment,
                attachmentDecrypt,
                isEdited: msg.is_edited,
                updatedAt: msg.updated_at,
                deletedAt: msg.deleted_at,
              };
            }),
          );
          msgs.reverse();
          this.chatMessages.set(msgs);
        }
      });
  }

  onChatLoadMore(): void {
    const id = this.expandedConsultationId();
    if (!id || this.isChatLoadingMore() || !this.chatHasMore()) return;

    this.isChatLoadingMore.set(true);
    this.chatCurrentPage++;

    this.consultationService.getConsultationMessagesPaginated(id, this.chatCurrentPage)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: async response => {
          this.chatHasMore.set(!!response.next);
          const currentUserId = this.currentUser()?.pk;
          const olderMsgs: Message[] = (
            await Promise.all(
              response.results.map(async msg => {
                const isSystem = !msg.created_by;
                const isCurrentUser = isSystem ? false : msg.created_by.id === currentUserId;
                const decryptedMessage = await this.decryptIfNeeded(
                  msg.content,
                  msg.is_encrypted,
                );
                const { attachment, attachmentDecrypt } =
                  await this.buildAttachmentDecryptor(msg);
                return {
                  id: msg.id,
                  username: isSystem ? '' : isCurrentUser
                    ? this.t.instant('consultationDetail.you')
                    : `${msg.created_by.first_name} ${msg.created_by.last_name}`.trim(),
                  message: decryptedMessage,
                  timestamp: msg.created_at,
                  isCurrentUser,
                  isSystem,
                  attachment,
                  attachmentDecrypt,
                  isEdited: msg.is_edited,
                  updatedAt: msg.updated_at,
                  deletedAt: msg.deleted_at,
                };
              }),
            )
          ).reverse();
          this.chatMessages.update(msgs => [...olderMsgs, ...msgs]);
          this.isChatLoadingMore.set(false);
        },
        error: () => {
          this.chatCurrentPage--;
          this.isChatLoadingMore.set(false);
        }
      });
  }

  async onChatSendMessage(data: SendMessageData): Promise<void> {
    const id = this.expandedConsultationId();
    if (!id) return;

    let content = data.content || '';
    let attachment = data.attachment;
    let isEncrypted = false;
    let encryptedAttachmentMetadata: string | null = null;

    const consultation = this.consultations().find(c => c.id === id);
    const consultPub = consultation?.public_key
      || this.chatConsultationPublicKey
      || null;
    if (consultation?.is_encrypted && consultPub) {
      isEncrypted = true;
      if (data.content) {
        content = await this.encryptionService.encryptString(data.content, consultPub);
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

    this.consultationService.sendConsultationMessage(id, content, attachment, {
      is_encrypted: isEncrypted || undefined,
      encrypted_attachment_metadata: encryptedAttachmentMetadata,
    })
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: () => {
          this.consultationService.markConsultationRead(id)
            .pipe(takeUntil(this.destroy$))
            .subscribe();
        },
        error: async (error) => {
          const toast = await this.toastController.create({
            message: error?.error?.detail || this.t.instant('consultationDetail.failedSend'),
            duration: 3000,
            position: 'bottom',
            color: 'danger'
          });
          await toast.present();
        }
      });
  }

  onChatEditMessage(data: EditMessageData): void {
    this.consultationService.updateConsultationMessage(data.messageId, data.content)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: updatedMessage => {
          this.chatMessages.update(msgs =>
            msgs.map(m => m.id === data.messageId
              ? { ...m, message: updatedMessage.content || '', isEdited: updatedMessage.is_edited, updatedAt: updatedMessage.updated_at }
              : m
            )
          );
        }
      });
  }

  onChatDeleteMessage(data: DeleteMessageData): void {
    this.consultationService.deleteConsultationMessage(data.messageId)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: deletedMessage => {
          this.chatMessages.update(msgs =>
            msgs.map(m => m.id === data.messageId
              ? { ...m, message: '', attachment: null, deletedAt: deletedMessage.deleted_at }
              : m
            )
          );
        }
      });
  }

  // --- Unread counts ---

  private updateUnreadCountsFromData(response: any): void {
    const expandedId = this.expandedConsultationId();
    const counts = new Map<number, number>();
    for (const req of (response.requests || [])) {
      if (req.consultation?.id && req.consultation.unread_count && req.consultation.id !== expandedId) {
        counts.set(req.consultation.id, req.consultation.unread_count);
      }
    }
    for (const c of (response.consultations || [])) {
      if (c.id && c.unread_count && c.id !== expandedId) {
        counts.set(c.id, c.unread_count);
      }
    }
    this.unreadCounts.set(counts);
  }

  getUnreadCount(consultationId: number): number {
    return this.unreadCounts().get(consultationId) || 0;
  }

  private incrementUnreadCount(consultationId: number): void {
    this.unreadCounts.update(counts => {
      const updated = new Map(counts);
      updated.set(consultationId, (updated.get(consultationId) || 0) + 1);
      return updated;
    });
  }

  private clearUnreadCount(consultationId: number): void {
    this.unreadCounts.update(counts => {
      const updated = new Map(counts);
      updated.delete(consultationId);
      return updated;
    });
  }
}
