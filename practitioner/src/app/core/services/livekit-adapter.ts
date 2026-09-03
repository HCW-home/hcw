import { Observable, Subscription, map } from 'rxjs';

import { LiveKitService, ParticipantInfo as LiveKitParticipantInfo } from './livekit.service';
import {
  AttachableTrack,
  ConnectionStatus,
  ParticipantInfo,
  VideoCallConfig,
  VideoCallDeviceIds,
  VideoCallImpl,
} from './video-call.types';

// Adapter that exposes the LiveKitService surface as VideoCallImpl. The
// adapter normalizes livekit-client types into framework-agnostic
// AttachableTrack + ParticipantInfo so the rest of the app does not need
// to import livekit-client.
//
// LiveKit's own Track objects already implement attach()/detach(), so they are
// passed straight through: unwrapping them to a raw MediaStreamTrack is what
// broke adaptiveStream (see AttachableTrack in video-call.types.ts).
export class LiveKitAdapter implements VideoCallImpl {
  private inner = new LiveKitService();

  readonly connectionStatus$: Observable<ConnectionStatus> = this.inner.connectionStatus$;
  readonly participants$: Observable<Map<string, ParticipantInfo>> = this.inner.participants$.pipe(
    map((src) => normalizeParticipants(src)),
  );
  readonly localVideoTrack$: Observable<AttachableTrack | null> = this.inner.localVideoTrack$;
  readonly localAudioTrack$: Observable<AttachableTrack | null> = this.inner.localAudioTrack$;
  readonly localScreenShareTrack$: Observable<AttachableTrack | null> =
    this.inner.localScreenShareTrack$;
  readonly isCameraEnabled$: Observable<boolean> = this.inner.isCameraEnabled$;
  readonly isMicrophoneEnabled$: Observable<boolean> = this.inner.isMicrophoneEnabled$;
  readonly isScreenShareEnabled$: Observable<boolean> = this.inner.isScreenShareEnabled$;
  readonly error$: Observable<string> = this.inner.error$;
  readonly removedByServer$: Observable<void> = this.inner.removedByServer$;

  connect(config: VideoCallConfig, deviceIds?: VideoCallDeviceIds): Promise<void> {
    return this.inner.connect(
      { url: config.url, room: config.room, token: config.token },
      undefined,
      deviceIds,
    );
  }

  disconnect(): Promise<void> {
    return this.inner.disconnect();
  }

  enableCamera(enable: boolean): Promise<void> {
    return this.inner.enableCamera(enable);
  }

  enableMicrophone(enable: boolean): Promise<void> {
    return this.inner.enableMicrophone(enable);
  }

  toggleCamera(): Promise<void> {
    return this.inner.toggleCamera();
  }

  toggleMicrophone(): Promise<void> {
    return this.inner.toggleMicrophone();
  }

  startScreenShare(): Promise<void> {
    return this.inner.startScreenShare();
  }

  stopScreenShare(): Promise<void> {
    return this.inner.stopScreenShare();
  }

  toggleScreenShare(): Promise<void> {
    return this.inner.toggleScreenShare();
  }

  switchCamera(deviceId: string): Promise<void> {
    return this.inner.switchCamera(deviceId);
  }

  switchMicrophone(deviceId: string): Promise<void> {
    return this.inner.switchMicrophone(deviceId);
  }

  switchSpeaker(deviceId: string): Promise<void> {
    return this.inner.switchSpeaker(deviceId);
  }

  supportsBackgroundBlur(): Promise<boolean> {
    return this.inner.supportsBackgroundBlur();
  }

  setBackgroundBlur(enabled: boolean): Promise<void> {
    return this.inner.setBackgroundBlur(enabled);
  }

  isConnected(): boolean {
    return this.inner.isConnected();
  }
}

function normalizeParticipants(
  src: Map<string, LiveKitParticipantInfo>,
): Map<string, ParticipantInfo> {
  const out = new Map<string, ParticipantInfo>();
  for (const [identity, p] of src) {
    out.set(identity, {
      identity: p.identity,
      name: p.name,
      isSpeaking: p.isSpeaking,
      isCameraEnabled: p.isCameraEnabled,
      isMicrophoneEnabled: p.isMicrophoneEnabled,
      isScreenShareEnabled: p.isScreenShareEnabled,
      videoTrack: p.videoTrack,
      audioTrack: p.audioTrack,
      screenShareTrack: p.screenShareTrack,
    });
  }
  return out;
}
