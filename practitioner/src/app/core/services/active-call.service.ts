import { Injectable, signal } from '@angular/core';
import { VideoCallConfig } from './video-call.types';

export interface ActiveCallConfig {
  appointmentId?: number;
  consultationId?: number;
  videoCallConfig?: VideoCallConfig;
}

@Injectable({
  providedIn: 'root',
})
export class ActiveCallService {
  private _activeCall = signal<ActiveCallConfig | null>(null);
  private _isFullscreen = signal(false);

  readonly activeCall = this._activeCall.asReadonly();
  readonly isFullscreen = this._isFullscreen.asReadonly();

  get hasActiveCall(): boolean {
    return this._activeCall() !== null;
  }

  startCall(config: ActiveCallConfig): void {
    this._activeCall.set(config);
    this._isFullscreen.set(true);
  }

  /**
   * Late-binds the follow-up to a call started from an appointment alone
   * (appointments list, incoming call, deep link): its id only comes back with
   * the join response. Patching the signal is what makes the PiP bind its chat
   * to the right follow-up.
   *
   * Keeps the same reference when nothing changes, so the signal stays quiet.
   */
  setConsultationId(consultationId: number): void {
    this._activeCall.update(call =>
      call && call.consultationId !== consultationId
        ? { ...call, consultationId }
        : call
    );
  }

  endCall(): void {
    this._activeCall.set(null);
    this._isFullscreen.set(false);
  }

  toggleFullscreen(): void {
    this._isFullscreen.update(v => !v);
  }

  minimize(): void {
    this._isFullscreen.set(false);
  }

  maximize(): void {
    this._isFullscreen.set(true);
  }
}
