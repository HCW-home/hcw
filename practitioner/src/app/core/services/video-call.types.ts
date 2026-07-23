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

export interface ParticipantInfo {
  identity: string;
  name: string;
  isSpeaking: boolean;
  isCameraEnabled: boolean;
  isMicrophoneEnabled: boolean;
  isScreenShareEnabled: boolean;
  videoTrack: MediaStreamTrack | null;
  audioTrack: MediaStreamTrack | null;
  screenShareTrack: MediaStreamTrack | null;
}

export interface VideoCallDeviceIds {
  camera?: string;
  microphone?: string;
}

export interface VideoCallImpl {
  connectionStatus$: Observable<ConnectionStatus>;
  participants$: Observable<Map<string, ParticipantInfo>>;
  localVideoTrack$: Observable<MediaStreamTrack | null>;
  localAudioTrack$: Observable<MediaStreamTrack | null>;
  localScreenShareTrack$: Observable<MediaStreamTrack | null>;
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
