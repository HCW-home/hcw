import { Injectable, OnDestroy } from '@angular/core';
import { BehaviorSubject, Observable, Subject } from 'rxjs';

import {
  ConnectionStatus,
  ParticipantInfo,
  VideoCallConfig,
  VideoCallDeviceIds,
  VideoCallImpl,
} from './video-call.types';

const EMPTY_PARTICIPANTS = new Map<string, ParticipantInfo>();

@Injectable({ providedIn: 'root' })
export class VideoCallService implements OnDestroy {
  private impl: VideoCallImpl | null = null;
  private subs: { unsubscribe(): void }[] = [];

  private connectionStatus = new BehaviorSubject<ConnectionStatus>('disconnected');
  private participants = new BehaviorSubject<Map<string, ParticipantInfo>>(EMPTY_PARTICIPANTS);
  private localVideo = new BehaviorSubject<MediaStreamTrack | null>(null);
  private localAudio = new BehaviorSubject<MediaStreamTrack | null>(null);
  private localScreen = new BehaviorSubject<MediaStreamTrack | null>(null);
  private cameraEnabled = new BehaviorSubject<boolean>(false);
  private microphoneEnabled = new BehaviorSubject<boolean>(false);
  private screenShareEnabled = new BehaviorSubject<boolean>(false);
  private errorSubject = new Subject<string>();
  private removedByServerSubject = new Subject<void>();

  readonly connectionStatus$: Observable<ConnectionStatus> = this.connectionStatus.asObservable();
  readonly participants$: Observable<Map<string, ParticipantInfo>> = this.participants.asObservable();
  readonly localVideoTrack$: Observable<MediaStreamTrack | null> = this.localVideo.asObservable();
  readonly localAudioTrack$: Observable<MediaStreamTrack | null> = this.localAudio.asObservable();
  readonly localScreenShareTrack$: Observable<MediaStreamTrack | null> = this.localScreen.asObservable();
  readonly isCameraEnabled$: Observable<boolean> = this.cameraEnabled.asObservable();
  readonly isMicrophoneEnabled$: Observable<boolean> = this.microphoneEnabled.asObservable();
  readonly isScreenShareEnabled$: Observable<boolean> = this.screenShareEnabled.asObservable();
  readonly error$: Observable<string> = this.errorSubject.asObservable();
  readonly removedByServer$: Observable<void> = this.removedByServerSubject.asObservable();

  async connect(config: VideoCallConfig, deviceIds?: VideoCallDeviceIds): Promise<void> {
    await this.disconnect();
    this.impl = await this.loadImpl(config);
    this.wireImpl(this.impl);
    await this.impl.connect(config, deviceIds);
  }

  async disconnect(): Promise<void> {
    if (this.impl) {
      try {
        await this.impl.disconnect();
      } finally {
        this.teardownImpl();
      }
    }
  }

  async enableCamera(enable: boolean): Promise<void> {
    return this.requireImpl().enableCamera(enable);
  }

  async enableMicrophone(enable: boolean): Promise<void> {
    return this.requireImpl().enableMicrophone(enable);
  }

  async toggleCamera(): Promise<void> {
    return this.requireImpl().toggleCamera();
  }

  async toggleMicrophone(): Promise<void> {
    return this.requireImpl().toggleMicrophone();
  }

  async startScreenShare(): Promise<void> {
    return this.requireImpl().startScreenShare();
  }

  async stopScreenShare(): Promise<void> {
    return this.requireImpl().stopScreenShare();
  }

  async toggleScreenShare(): Promise<void> {
    return this.requireImpl().toggleScreenShare();
  }

  async switchCamera(deviceId: string): Promise<void> {
    return this.requireImpl().switchCamera(deviceId);
  }

  async switchMicrophone(deviceId: string): Promise<void> {
    return this.requireImpl().switchMicrophone(deviceId);
  }

  async switchSpeaker(deviceId: string): Promise<void> {
    return this.requireImpl().switchSpeaker(deviceId);
  }

  isConnected(): boolean {
    return this.impl?.isConnected() ?? false;
  }

  ngOnDestroy(): void {
    this.disconnect();
  }

  private requireImpl(): VideoCallImpl {
    if (!this.impl) {
      throw new Error('VideoCallService.connect() must be called before this operation');
    }
    return this.impl;
  }

  private async loadImpl(config: VideoCallConfig): Promise<VideoCallImpl> {
    if (config.provider === 'livekit') {
      const mod = await import('./livekit-adapter');
      return new mod.LiveKitAdapter();
    }
    if (config.provider === 'mediasoup') {
      const mod = await import('./mediasoup.service');
      return new mod.MediasoupService();
    }
    throw new Error(`Unknown video provider: ${(config as { provider: string }).provider}`);
  }

  private wireImpl(impl: VideoCallImpl): void {
    this.subs.push(impl.connectionStatus$.subscribe((v) => this.connectionStatus.next(v)));
    this.subs.push(impl.participants$.subscribe((v) => this.participants.next(v)));
    this.subs.push(impl.localVideoTrack$.subscribe((v) => this.localVideo.next(v)));
    this.subs.push(impl.localAudioTrack$.subscribe((v) => this.localAudio.next(v)));
    this.subs.push(impl.localScreenShareTrack$.subscribe((v) => this.localScreen.next(v)));
    this.subs.push(impl.isCameraEnabled$.subscribe((v) => this.cameraEnabled.next(v)));
    this.subs.push(impl.isMicrophoneEnabled$.subscribe((v) => this.microphoneEnabled.next(v)));
    this.subs.push(impl.isScreenShareEnabled$.subscribe((v) => this.screenShareEnabled.next(v)));
    this.subs.push(impl.error$.subscribe((v) => this.errorSubject.next(v)));
    this.subs.push(impl.removedByServer$.subscribe(() => this.removedByServerSubject.next()));
  }

  private teardownImpl(): void {
    for (const sub of this.subs) {
      sub.unsubscribe();
    }
    this.subs = [];
    this.impl = null;
    this.connectionStatus.next('disconnected');
    this.participants.next(EMPTY_PARTICIPANTS);
    this.localVideo.next(null);
    this.localAudio.next(null);
    this.localScreen.next(null);
    this.cameraEnabled.next(false);
    this.microphoneEnabled.next(false);
    this.screenShareEnabled.next(false);
  }
}
