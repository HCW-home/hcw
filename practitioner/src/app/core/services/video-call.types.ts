import { Observable } from 'rxjs';

export type VideoProvider = 'livekit' | 'mediasoup';

export interface VideoCallConfig {
  provider: VideoProvider;
  url: string;
  token: string;
  room: string;
  identity?: string;
  displayName?: string;
}

export type ConnectionStatus =
  | 'disconnected'
  | 'connecting'
  | 'connected'
  | 'reconnecting'
  | 'failed';

/**
 * A media track that knows how to bind itself to a media element.
 *
 * LiveKit's `adaptiveStream` decides whether to send video at all by observing
 * the elements a track has been attached to through its own `attach()`/
 * `detach()` API. Assigning `element.srcObject` by hand bypasses that
 * bookkeeping, so LiveKit sees no visible element, concludes nobody is watching
 * and stops or degrades the stream — the call freezes. Providers therefore
 * expose attach/detach rather than a raw track, and callers must use them.
 *
 * `mediaStreamTrack` stays available for consumers that genuinely need the raw
 * track (e.g. audio analysis), but must not be used to render video.
 */
export interface AttachableTrack {
  readonly mediaStreamTrack: MediaStreamTrack;
  attach(element: HTMLMediaElement): void;
  detach(element?: HTMLMediaElement): void;
}

/**
 * Wraps a raw MediaStreamTrack for providers that have no attach API of their
 * own (mediasoup). Mirrors LiveKit's attach/detach semantics so the UI can
 * treat every provider identically.
 */
export function toAttachableTrack(track: MediaStreamTrack): AttachableTrack {
  return {
    mediaStreamTrack: track,
    attach(element: HTMLMediaElement): void {
      const current = element.srcObject;
      // Re-assigning an identical stream restarts playback and makes the
      // element flicker, so only touch srcObject when the track really changed.
      if (current instanceof MediaStream && current.getTracks().includes(track)) {
        return;
      }
      element.srcObject = new MediaStream([track]);
    },
    detach(element?: HTMLMediaElement): void {
      if (element) {
        element.srcObject = null;
      }
    },
  };
}

export interface ParticipantInfo {
  identity: string;
  name: string;
  isSpeaking: boolean;
  isCameraEnabled: boolean;
  isMicrophoneEnabled: boolean;
  isScreenShareEnabled: boolean;
  videoTrack: AttachableTrack | null;
  audioTrack: AttachableTrack | null;
  screenShareTrack: AttachableTrack | null;
}

export interface VideoCallDeviceIds {
  camera?: string;
  microphone?: string;
}

export interface VideoCallImpl {
  connectionStatus$: Observable<ConnectionStatus>;
  participants$: Observable<Map<string, ParticipantInfo>>;
  localVideoTrack$: Observable<AttachableTrack | null>;
  localAudioTrack$: Observable<AttachableTrack | null>;
  localScreenShareTrack$: Observable<AttachableTrack | null>;
  isCameraEnabled$: Observable<boolean>;
  isMicrophoneEnabled$: Observable<boolean>;
  isScreenShareEnabled$: Observable<boolean>;
  error$: Observable<string>;
  /**
   * Emits when the media server forcibly removed us from the call (e.g. the
   * practitioner closed the consultation). Distinct from a normal disconnect:
   * the UI should tear the call down and navigate away rather than wait for a
   * reconnect.
   */
  removedByServer$: Observable<void>;

  connect(config: VideoCallConfig, deviceIds?: VideoCallDeviceIds): Promise<void>;
  disconnect(): Promise<void>;
  enableCamera(enable: boolean): Promise<void>;
  enableMicrophone(enable: boolean): Promise<void>;
  toggleCamera(): Promise<void>;
  toggleMicrophone(): Promise<void>;
  startScreenShare(): Promise<void>;
  stopScreenShare(): Promise<void>;
  toggleScreenShare(): Promise<void>;
  switchCamera(deviceId: string): Promise<void>;
  switchMicrophone(deviceId: string): Promise<void>;
  switchSpeaker(deviceId: string): Promise<void>;
  isConnected(): boolean;
}
