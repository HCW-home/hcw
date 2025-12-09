import { Component, OnInit, OnDestroy, ViewChild, ElementRef, ChangeDetectorRef } from '@angular/core';
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
  NavController,
  AlertController,
  ToastController
} from '@ionic/angular/standalone';
import { Subject, interval, Subscription } from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import { LocalVideoTrack } from 'livekit-client';

import { LiveKitService, ParticipantInfo, ConnectionStatus } from '../../core/services/livekit.service';
import { ConsultationService } from '../../core/services/consultation.service';

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
    IonChip
  ]
})
export class VideoConsultationPage implements OnInit, OnDestroy {
  @ViewChild('localVideo') localVideoRef!: ElementRef<HTMLVideoElement>;
  @ViewChild('participantsContainer') participantsContainerRef!: ElementRef<HTMLDivElement>;

  appointmentId: number | null = null;
  consultationId: number | null = null;

  connectionStatus: ConnectionStatus = 'disconnected';
  participants: Map<string, ParticipantInfo> = new Map();
  localVideoTrack: LocalVideoTrack | null = null;

  isCameraEnabled = false;
  isMicrophoneEnabled = false;
  isScreenShareEnabled = false;
  isSpeakerOn = true;
  showControls = true;

  callDuration = 0;
  formattedDuration = '00:00';
  isLoading = false;
  errorMessage = '';

  private destroy$ = new Subject<void>();
  private durationTimer: Subscription | null = null;
  private controlsTimer: ReturnType<typeof setTimeout> | null = null;
  private videoElements = new Map<string, HTMLVideoElement>();
  private audioElements = new Map<string, HTMLAudioElement>();

  constructor(
    private route: ActivatedRoute,
    public navCtrl: NavController,
    private alertCtrl: AlertController,
    private toastCtrl: ToastController,
    private livekitService: LiveKitService,
    private consultationService: ConsultationService,
    private cdr: ChangeDetectorRef
  ) {}

  ngOnInit(): void {
    const idParam = this.route.snapshot.paramMap.get('id');
    const type = this.route.snapshot.queryParamMap.get('type');

    if (idParam) {
      const id = parseInt(idParam, 10);
      if (type === 'consultation') {
        this.consultationId = id;
      } else {
        this.appointmentId = id;
      }
    }

    this.setupSubscriptions();
    this.joinRoom();
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
    this.livekitService.disconnect();
    this.cleanupMediaElements();
    this.stopDurationTimer();
  }

  private setupSubscriptions(): void {
    this.livekitService.connectionStatus$
      .pipe(takeUntil(this.destroy$))
      .subscribe(status => {
        this.connectionStatus = status;
        if (status === 'connected' && !this.durationTimer) {
          this.startDurationTimer();
        }
        this.cdr.markForCheck();
      });

    this.livekitService.localVideoTrack$
      .pipe(takeUntil(this.destroy$))
      .subscribe(track => {
        this.localVideoTrack = track;
        this.attachLocalVideo();
        this.cdr.markForCheck();
      });

    this.livekitService.participants$
      .pipe(takeUntil(this.destroy$))
      .subscribe(participants => {
        this.participants = participants;
        this.attachRemoteMedia();
        this.cdr.markForCheck();
      });

    this.livekitService.isCameraEnabled$
      .pipe(takeUntil(this.destroy$))
      .subscribe(enabled => {
        this.isCameraEnabled = enabled;
        this.cdr.markForCheck();
      });

    this.livekitService.isMicrophoneEnabled$
      .pipe(takeUntil(this.destroy$))
      .subscribe(enabled => {
        this.isMicrophoneEnabled = enabled;
        this.cdr.markForCheck();
      });

    this.livekitService.isScreenShareEnabled$
      .pipe(takeUntil(this.destroy$))
      .subscribe(enabled => {
        this.isScreenShareEnabled = enabled;
        this.cdr.markForCheck();
      });

    this.livekitService.error$
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
      let config: { url: string; token: string; room: string } | undefined;

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
        throw new Error('Failed to get LiveKit configuration');
      }

      await this.livekitService.connect(config);
      await this.livekitService.enableCamera(true);
      await this.livekitService.enableMicrophone(true);
      this.showToast('Connected to consultation');
    } catch (error) {
      this.errorMessage = error instanceof Error ? error.message : 'Failed to join video call';
      this.showToast(this.errorMessage);
    } finally {
      this.isLoading = false;
      this.cdr.markForCheck();
    }
  }

  private attachLocalVideo(): void {
    if (!this.localVideoRef?.nativeElement || !this.localVideoTrack) return;
    this.localVideoTrack.attach(this.localVideoRef.nativeElement);
  }

  private attachRemoteMedia(): void {
    if (!this.participantsContainerRef?.nativeElement) return;

    const currentParticipantIds = new Set(this.participants.keys());
    const existingElementIds = new Set(this.videoElements.keys());

    for (const id of existingElementIds) {
      if (!currentParticipantIds.has(id)) {
        this.removeParticipantElements(id);
      }
    }

    for (const [identity, participant] of this.participants) {
      this.attachParticipantMedia(identity, participant);
    }
  }

  private attachParticipantMedia(identity: string, participant: ParticipantInfo): void {
    if (participant.videoTrack) {
      let videoEl = this.videoElements.get(identity);
      if (!videoEl) {
        videoEl = document.createElement('video');
        videoEl.autoplay = true;
        videoEl.playsInline = true;
        videoEl.className = 'participant-video';
        videoEl.id = `video-${identity}`;
        this.videoElements.set(identity, videoEl);

        if (this.participantsContainerRef?.nativeElement) {
          this.participantsContainerRef.nativeElement.appendChild(videoEl);
        }
      }

      if (participant.videoTrack.attachedElements.indexOf(videoEl) === -1) {
        participant.videoTrack.attach(videoEl);
      }
    }

    if (participant.audioTrack) {
      let audioEl = this.audioElements.get(identity);
      if (!audioEl) {
        audioEl = document.createElement('audio');
        audioEl.autoplay = true;
        audioEl.id = `audio-${identity}`;
        this.audioElements.set(identity, audioEl);
        document.body.appendChild(audioEl);
      }

      audioEl.muted = !this.isSpeakerOn;

      if (participant.audioTrack.attachedElements.indexOf(audioEl) === -1) {
        participant.audioTrack.attach(audioEl);
      }
    }
  }

  private removeParticipantElements(identity: string): void {
    const videoEl = this.videoElements.get(identity);
    if (videoEl) {
      videoEl.srcObject = null;
      videoEl.remove();
      this.videoElements.delete(identity);
    }

    const audioEl = this.audioElements.get(identity);
    if (audioEl) {
      audioEl.srcObject = null;
      audioEl.remove();
      this.audioElements.delete(identity);
    }
  }

  private cleanupMediaElements(): void {
    for (const [identity] of this.videoElements) {
      this.removeParticipantElements(identity);
    }
    this.videoElements.clear();
    this.audioElements.clear();
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
      await this.livekitService.toggleCamera();
    } catch (error) {
      this.showToast('Failed to toggle camera');
    }
  }

  async toggleMicrophone(): Promise<void> {
    try {
      await this.livekitService.toggleMicrophone();
    } catch (error) {
      this.showToast('Failed to toggle microphone');
    }
  }

  toggleSpeaker(): void {
    this.isSpeakerOn = !this.isSpeakerOn;
    for (const audioEl of this.audioElements.values()) {
      audioEl.muted = !this.isSpeakerOn;
    }
  }

  async toggleScreenShare(): Promise<void> {
    try {
      await this.livekitService.toggleScreenShare();
    } catch (error) {
      this.showToast('Failed to toggle screen share');
    }
  }

  switchCamera(): void {
    this.showToast('Switching camera...');
  }

  async endCall(): Promise<void> {
    const alert = await this.alertCtrl.create({
      header: 'End Consultation',
      message: 'Are you sure you want to end this consultation?',
      buttons: [
        {
          text: 'Cancel',
          role: 'cancel'
        },
        {
          text: 'End Call',
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
    await this.livekitService.disconnect();
    this.stopDurationTimer();

    setTimeout(() => {
      this.navCtrl.navigateBack('/tabs/appointments');
    }, 1500);
  }

  onVideoAreaTap(): void {
    this.showControls = !this.showControls;

    if (this.controlsTimer) {
      clearTimeout(this.controlsTimer);
    }

    if (this.showControls) {
      this.controlsTimer = setTimeout(() => {
        this.showControls = false;
        this.cdr.markForCheck();
      }, 5000);
    }
  }

  openChat(): void {
    this.showToast('Chat panel coming soon');
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
      case 'connecting': return 'Connecting to consultation...';
      case 'reconnecting': return 'Reconnecting...';
      case 'disconnected': return 'Disconnected';
      case 'failed': return 'Connection failed';
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

  getParticipantVideoElement(identity: string): HTMLVideoElement | undefined {
    return this.videoElements.get(identity);
  }
}
