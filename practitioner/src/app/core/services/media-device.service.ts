import { Injectable, OnDestroy } from '@angular/core';
import { BehaviorSubject, Observable } from 'rxjs';
import { IMediaDevices } from '../models/media-device';

@Injectable({
  providedIn: 'root',
})
export class MediaDeviceService implements OnDestroy {
  private devicesSubject = new BehaviorSubject<IMediaDevices>({
    cameras: [],
    microphones: [],
    speakers: [],
  });
  private audioLevelSubject = new BehaviorSubject<number>(0);

  private previewStream: MediaStream | null = null;
  private audioContext: AudioContext | null = null;
  private analyserNode: AnalyserNode | null = null;
  private audioMonitorStream: MediaStream | null = null;
  private animationFrameId: number | null = null;
  private deviceChangeHandler = (): void => {
    this.enumerateDevices();
  };

  devices$: Observable<IMediaDevices> = this.devicesSubject.asObservable();
  audioLevel$: Observable<number> = this.audioLevelSubject.asObservable();

  constructor() {
    if (navigator.mediaDevices?.addEventListener) {
      navigator.mediaDevices.addEventListener('devicechange', this.deviceChangeHandler);
    }
  }

  async enumerateDevices(): Promise<IMediaDevices> {
    const devices = await navigator.mediaDevices.enumerateDevices();
    const result: IMediaDevices = {
      cameras: devices.filter(d => d.kind === 'videoinput'),
      microphones: devices.filter(d => d.kind === 'audioinput'),
      speakers: devices.filter(d => d.kind === 'audiooutput'),
    };
    this.devicesSubject.next(result);
    return result;
  }

  async startVideoPreview(deviceId?: string): Promise<MediaStream> {
    this.stopVideoPreview();
    const constraints: MediaStreamConstraints = {
      video: deviceId ? { deviceId: { exact: deviceId } } : true,
    };
    this.previewStream = await navigator.mediaDevices.getUserMedia(constraints);
    return this.previewStream;
  }

  stopVideoPreview(): void {
    if (this.previewStream) {
      this.previewStream.getTracks().forEach(t => t.stop());
      this.previewStream = null;
    }
  }

  async switchCamera(deviceId: string): Promise<MediaStream> {
    return this.startVideoPreview(deviceId);
  }

  async startAudioMonitor(deviceId?: string): Promise<void> {
    this.stopAudioMonitor();
    const constraints: MediaStreamConstraints = {
      audio: deviceId ? { deviceId: { exact: deviceId } } : true,
    };
    this.audioMonitorStream = await navigator.mediaDevices.getUserMedia(constraints);
    this.audioContext = new AudioContext();
    const source = this.audioContext.createMediaStreamSource(this.audioMonitorStream);
    this.analyserNode = this.audioContext.createAnalyser();
    this.analyserNode.fftSize = 256;
    source.connect(this.analyserNode);
    this.pollAudioLevel();
  }

  private pollAudioLevel(): void {
    if (!this.analyserNode) return;
    const data = new Uint8Array(this.analyserNode.frequencyBinCount);
    this.analyserNode.getByteFrequencyData(data);
    let sum = 0;
    for (let i = 0; i < data.length; i++) {
      sum += data[i];
    }
    const average = sum / data.length / 255;
    this.audioLevelSubject.next(average);
    this.animationFrameId = requestAnimationFrame(() => this.pollAudioLevel());
  }

  stopAudioMonitor(): void {
    if (this.animationFrameId !== null) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }
    if (this.audioContext) {
      this.audioContext.close();
      this.audioContext = null;
    }
    this.analyserNode = null;
    if (this.audioMonitorStream) {
      this.audioMonitorStream.getTracks().forEach(t => t.stop());
      this.audioMonitorStream = null;
    }
    this.audioLevelSubject.next(0);
  }

  async switchMicrophone(deviceId: string): Promise<void> {
    await this.startAudioMonitor(deviceId);
  }

  stopPreview(): void {
    this.stopVideoPreview();
    this.stopAudioMonitor();
  }

  getPreviewStream(): MediaStream | null {
    return this.previewStream;
  }

  isSpeakerSelectionSupported(): boolean {
    return typeof HTMLMediaElement.prototype.setSinkId === 'function';
  }

  ngOnDestroy(): void {
    this.stopPreview();
    if (navigator.mediaDevices?.removeEventListener) {
      navigator.mediaDevices.removeEventListener('devicechange', this.deviceChangeHandler);
    }
  }
}
