import { Injectable, signal } from '@angular/core';

export interface ActiveCallConfig {
  appointmentId?: number;
  consultationId?: number;
  livekitConfig?: { url: string; token: string; room: string };
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
