import { Injectable } from '@angular/core';
import { NavController } from '@ionic/angular/standalone';
import { BehaviorSubject, Observable } from 'rxjs';

export interface IncomingCallData {
  callerName: string;
  callerPicture?: string;
  appointmentId: number;
  consultationId: number;
}

@Injectable({
  providedIn: 'root',
})
export class IncomingCallService {
  private incomingCallSubject = new BehaviorSubject<IncomingCallData | null>(null);
  private timeoutId: ReturnType<typeof setTimeout> | null = null;
  private audioElement: HTMLAudioElement | null = null;
  private activeCallAppointmentId: number | null = null;

  public incomingCall$: Observable<IncomingCallData | null> = this.incomingCallSubject.asObservable();

  constructor(
    private navCtrl: NavController
  ) {}

  showIncomingCall(data: IncomingCallData): void {
    console.log('[IncomingCall] showIncomingCall called:', data);
    console.log('[IncomingCall] activeCallAppointmentId:', this.activeCallAppointmentId);

    if (this.incomingCallSubject.value) {
      console.log('[IncomingCall] Already showing a call, skipping');
      return;
    }

    if (this.activeCallAppointmentId === data.appointmentId) {
      console.log('[IncomingCall] Already in call for this appointment, skipping');
      return;
    }

    console.log('[IncomingCall] Showing incoming call screen');
    this.incomingCallSubject.next(data);
    this.playRingtone();
    this.startTimeout();
  }

  dismissIncomingCall(): void {
    this.stopRingtone();
    this.clearTimeout();
    this.incomingCallSubject.next(null);
  }

  acceptCall(): void {
    const callData = this.incomingCallSubject.value;
    if (!callData) {
      return;
    }

    this.stopRingtone();
    this.clearTimeout();
    this.incomingCallSubject.next(null);

    this.navCtrl.navigateForward(['/consultation', callData.consultationId, 'video'], {
      queryParams: { appointmentId: callData.appointmentId, autoJoin: true }
    });
  }

  setActiveCall(appointmentId: number): void {
    this.activeCallAppointmentId = appointmentId;
  }

  clearActiveCall(): void {
    this.activeCallAppointmentId = null;
  }

  private playRingtone(): void {
    try {
      this.audioElement = new Audio('/assets/audio/ringtone.mp3');
      this.audioElement.loop = true;
      this.audioElement.play().catch(() => {});
    } catch {
    }
  }

  private stopRingtone(): void {
    if (this.audioElement) {
      this.audioElement.pause();
      this.audioElement.currentTime = 0;
      this.audioElement = null;
    }
  }

  private startTimeout(): void {
    this.clearTimeout();
    this.timeoutId = setTimeout(() => {
      this.dismissIncomingCall();
    }, 45000);
  }

  private clearTimeout(): void {
    if (this.timeoutId) {
      clearTimeout(this.timeoutId);
      this.timeoutId = null;
    }
  }
}
