import { Component, OnInit, OnDestroy, ViewChild, ElementRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute } from '@angular/router';
import {
  IonHeader,
  IonToolbar,
  IonTitle,
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
import { Subscription, interval } from 'rxjs';

type CallState = 'connecting' | 'connected' | 'reconnecting' | 'ended' | 'failed';

interface CallParticipant {
  id: number;
  name: string;
  avatar?: string;
  isMuted: boolean;
  isVideoOff: boolean;
}

@Component({
  selector: 'app-video-consultation',
  templateUrl: './video-consultation.page.html',
  styleUrls: ['./video-consultation.page.scss'],
  standalone: true,
  imports: [
    CommonModule,
    IonHeader,
    IonToolbar,
    IonTitle,
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
  @ViewChild('remoteVideo') remoteVideoRef!: ElementRef<HTMLVideoElement>;

  consultationId: string | null = null;
  callState: CallState = 'connecting';
  callDuration = 0;
  formattedDuration = '00:00';

  isAudioMuted = false;
  isVideoOff = false;
  isSpeakerOn = true;
  isScreenSharing = false;
  showControls = true;

  localStream: MediaStream | null = null;
  remoteParticipant: CallParticipant = {
    id: 0,
    name: 'Dr. Smith',
    isMuted: false,
    isVideoOff: false
  };

  private subscriptions: Subscription[] = [];
  private durationTimer: Subscription | null = null;
  private controlsTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private route: ActivatedRoute,
    public navCtrl: NavController,
    private alertCtrl: AlertController,
    private toastCtrl: ToastController
  ) {}

  ngOnInit() {
    this.consultationId = this.route.snapshot.paramMap.get('id');
    this.initializeCall();
  }

  ngOnDestroy() {
    this.cleanup();
    this.subscriptions.forEach(sub => sub.unsubscribe());
  }

  async initializeCall(): Promise<void> {
    try {
      await this.requestMediaPermissions();
      this.simulateConnection();
    } catch (error) {
      this.callState = 'failed';
      this.showToast('Failed to access camera/microphone');
    }
  }

  private async requestMediaPermissions(): Promise<void> {
    try {
      this.localStream = await navigator.mediaDevices.getUserMedia({
        video: true,
        audio: true
      });

      if (this.localVideoRef?.nativeElement) {
        this.localVideoRef.nativeElement.srcObject = this.localStream;
      }
    } catch (error) {
      throw error;
    }
  }

  private simulateConnection(): void {
    setTimeout(() => {
      this.callState = 'connected';
      this.startDurationTimer();
      this.showToast('Connected to consultation');
    }, 2000);
  }

  private startDurationTimer(): void {
    this.durationTimer = interval(1000).subscribe(() => {
      this.callDuration++;
      this.formattedDuration = this.formatDuration(this.callDuration);
    });
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

  toggleAudio(): void {
    this.isAudioMuted = !this.isAudioMuted;
    if (this.localStream) {
      this.localStream.getAudioTracks().forEach(track => {
        track.enabled = !this.isAudioMuted;
      });
    }
  }

  toggleVideo(): void {
    this.isVideoOff = !this.isVideoOff;
    if (this.localStream) {
      this.localStream.getVideoTracks().forEach(track => {
        track.enabled = !this.isVideoOff;
      });
    }
  }

  toggleSpeaker(): void {
    this.isSpeakerOn = !this.isSpeakerOn;
    if (this.remoteVideoRef?.nativeElement) {
      this.remoteVideoRef.nativeElement.muted = !this.isSpeakerOn;
    }
  }

  switchCamera(): void {
    this.showToast('Switching camera...');
  }

  async toggleScreenShare(): Promise<void> {
    if (this.isScreenSharing) {
      this.stopScreenShare();
    } else {
      await this.startScreenShare();
    }
  }

  private async startScreenShare(): Promise<void> {
    try {
      const screenStream = await navigator.mediaDevices.getDisplayMedia({
        video: true
      });

      this.isScreenSharing = true;

      screenStream.getVideoTracks()[0].onended = () => {
        this.stopScreenShare();
      };

      this.showToast('Screen sharing started');
    } catch (error) {
      this.showToast('Failed to start screen sharing');
    }
  }

  private stopScreenShare(): void {
    this.isScreenSharing = false;
    this.showToast('Screen sharing stopped');
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

  private performEndCall(): void {
    this.callState = 'ended';
    this.cleanup();

    setTimeout(() => {
      this.navCtrl.navigateBack('/tabs/appointments');
    }, 1500);
  }

  private cleanup(): void {
    if (this.durationTimer) {
      this.durationTimer.unsubscribe();
      this.durationTimer = null;
    }

    if (this.controlsTimer) {
      clearTimeout(this.controlsTimer);
      this.controlsTimer = null;
    }

    if (this.localStream) {
      this.localStream.getTracks().forEach(track => track.stop());
      this.localStream = null;
    }
  }

  onVideoAreaTap(): void {
    this.showControls = !this.showControls;

    if (this.controlsTimer) {
      clearTimeout(this.controlsTimer);
    }

    if (this.showControls) {
      this.controlsTimer = setTimeout(() => {
        this.showControls = false;
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
    switch (this.callState) {
      case 'connecting': return 'Connecting to consultation...';
      case 'reconnecting': return 'Reconnecting...';
      case 'ended': return 'Consultation ended';
      case 'failed': return 'Connection failed';
      default: return '';
    }
  }
}
