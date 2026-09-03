export interface IMediaDevices {
  cameras: MediaDeviceInfo[];
  microphones: MediaDeviceInfo[];
  speakers: MediaDeviceInfo[];
}

export interface IPreJoinSettings {
  cameraEnabled: boolean;
  microphoneEnabled: boolean;
  backgroundBlurEnabled: boolean;
  cameraDeviceId: string | null;
  microphoneDeviceId: string | null;
  speakerDeviceId: string | null;
}
