import { Component, OnInit, OnDestroy, signal, ViewChild, ElementRef, inject, DestroyRef } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Page } from '../../../../core/components/page/page';
import { Button } from '../../../../shared/ui-components/button/button';
import { Typography } from '../../../../shared/ui-components/typography/typography';
import { Svg } from '../../../../shared/ui-components/svg/svg';
import {
  ButtonSizeEnum,
  ButtonStyleEnum,
} from '../../../../shared/constants/button';
import { TypographyTypeEnum } from '../../../../shared/constants/typography';
import { Router } from '@angular/router';
import { LiveKitService, ConnectionStatus } from '../../../../core/services/livekit.service';
import { UserService } from '../../../../core/services/user.service';
import { ToasterService } from '../../../../core/services/toaster.service';
import { LocalVideoTrack, LocalAudioTrack } from 'livekit-client';

type TestStatus = 'idle' | 'testing' | 'working' | 'error' | 'playing';

@Component({
  selector: 'app-test',
  imports: [Page, Button, Typography, Svg],
  templateUrl: './test.html',
  styleUrl: './test.scss',
})
export class Test implements OnInit, OnDestroy {
  @ViewChild('videoElement') videoElement?: ElementRef<HTMLVideoElement>;

  breadcrumbs = [{ label: 'System Test' }];

  connectionStatus = signal<ConnectionStatus>('disconnected');
  cameraStatus = signal<TestStatus>('idle');
  microphoneStatus = signal<TestStatus>('idle');
  speakerStatus = signal<TestStatus>('idle');
  systemStatus = signal<'checking' | 'ready' | 'partial' | 'error'>('checking');

  private localVideoTrack: LocalVideoTrack | null = null;
  private localAudioTrack: LocalAudioTrack | null = null;
  private audioContext: AudioContext | null = null;
  private analyserNode: AnalyserNode | null = null;
  private animationFrame: number | null = null;
  private testAudio: HTMLAudioElement | null = null;
  private isConnecting = false;

  volumeBars = signal<number[]>(Array(20).fill(0));
  soundWaves = signal<number[]>(Array(5).fill(0));

  protected readonly ButtonSizeEnum = ButtonSizeEnum;
  protected readonly ButtonStyleEnum = ButtonStyleEnum;
  protected readonly TypographyTypeEnum = TypographyTypeEnum;

  private router = inject(Router);
  private livekitService = inject(LiveKitService);
  private userService = inject(UserService);
  private toasterService = inject(ToasterService);
  private destroyRef = inject(DestroyRef);

  ngOnInit() {
    this.setupSubscriptions();
    this.updateSystemStatus();
  }

  ngOnDestroy() {
    this.cleanup();
  }

  private setupSubscriptions(): void {
    this.livekitService.connectionStatus$
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(status => {
        this.connectionStatus.set(status);
        this.updateSystemStatus();
      });

    this.livekitService.localVideoTrack$
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(track => {
        if (this.localVideoTrack && this.videoElement?.nativeElement) {
          this.localVideoTrack.detach(this.videoElement.nativeElement);
        }
        this.localVideoTrack = track;
        if (track) {
          if (this.cameraStatus() === 'testing') {
            this.cameraStatus.set('working');
            this.updateSystemStatus();
          }
          setTimeout(() => this.attachLocalVideo(), 50);
        }
      });

    this.livekitService.localAudioTrack$
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(track => {
        this.localAudioTrack = track;
        if (track) {
          this.setupAudioVisualization(track);
          if (this.microphoneStatus() === 'testing') {
            this.microphoneStatus.set('working');
            this.updateSystemStatus();
          }
        } else {
          this.stopAudioVisualization();
        }
      });

    this.livekitService.error$
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(error => {
        this.toasterService.show('error', 'Error', error);
      });
  }

  private async ensureConnected(): Promise<boolean> {
    if (this.livekitService.isConnected()) {
      return true;
    }

    if (this.isConnecting) {
      return false;
    }

    this.isConnecting = true;

    try {
      const config = await this.userService.getTestRtcInfo()
        .pipe(takeUntilDestroyed(this.destroyRef))
        .toPromise();

      if (!config) {
        throw new Error('Failed to get test connection info');
      }

      await this.livekitService.connect({
        url: config.url,
        token: config.token,
        room: config.room,
      });

      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to connect to server';
      this.toasterService.show('error', 'Connection Error', message);
      return false;
    } finally {
      this.isConnecting = false;
    }
  }

  systemStatusText(): string {
    switch (this.systemStatus()) {
      case 'checking':
        return 'Checking system...';
      case 'ready':
        return 'System Ready';
      case 'partial':
        return 'Partial functionality';
      case 'error':
        return 'System issues detected';
      default:
        return 'Unknown status';
    }
  }

  private updateSystemStatus() {
    const camera = this.cameraStatus();
    const mic = this.microphoneStatus();
    const speaker = this.speakerStatus();
    const connection = this.connectionStatus();

    if (connection === 'failed') {
      this.systemStatus.set('error');
    } else if (camera === 'working' && mic === 'working' && speaker === 'working') {
      this.systemStatus.set('ready');
    } else if (camera === 'error' && mic === 'error' && speaker === 'error') {
      this.systemStatus.set('error');
    } else if (camera === 'working' || mic === 'working' || speaker === 'working') {
      this.systemStatus.set('partial');
    } else {
      this.systemStatus.set('checking');
    }
  }

  getCameraStatusText(): string {
    switch (this.cameraStatus()) {
      case 'idle':
        return 'Not tested';
      case 'testing':
        return 'Testing...';
      case 'working':
        return 'Working';
      case 'error':
        return 'Error';
      default:
        return 'Unknown';
    }
  }

  getCameraPlaceholderText(): string {
    const connection = this.connectionStatus();
    if (connection === 'connecting') {
      return 'Connecting to server...';
    }
    switch (this.cameraStatus()) {
      case 'idle':
        return 'Click "Test Camera" to begin';
      case 'testing':
        return 'Accessing camera...';
      case 'error':
        return 'Camera access denied or unavailable';
      default:
        return 'Camera preview will appear here';
    }
  }

  async testCamera() {
    this.cameraStatus.set('testing');

    try {
      const connected = await this.ensureConnected();
      if (!connected) {
        this.cameraStatus.set('error');
        this.updateSystemStatus();
        return;
      }

      await this.livekitService.enableCamera(true);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Camera test failed';
      this.toasterService.show('error', 'Camera Error', message);
      this.cameraStatus.set('error');
      this.updateSystemStatus();
    }
  }

  private attachLocalVideo(): void {
    if (!this.videoElement?.nativeElement || !this.localVideoTrack) {
      return;
    }
    this.localVideoTrack.attach(this.videoElement.nativeElement);
  }

  async stopCamera() {
    try {
      if (this.localVideoTrack && this.videoElement?.nativeElement) {
        this.localVideoTrack.detach(this.videoElement.nativeElement);
      }
      await this.livekitService.enableCamera(false);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to stop camera';
      this.toasterService.show('error', 'Camera Error', message);
    }
    this.cameraStatus.set('idle');
    this.updateSystemStatus();
  }

  getMicrophoneStatusText(): string {
    switch (this.microphoneStatus()) {
      case 'idle':
        return 'Not tested';
      case 'testing':
        return 'Testing...';
      case 'working':
        return 'Working';
      case 'error':
        return 'Error';
      default:
        return 'Unknown';
    }
  }

  getAudioLevelText(): string {
    const connection = this.connectionStatus();
    if (connection === 'connecting') {
      return 'Connecting to server...';
    }
    if (this.microphoneStatus() === 'working') {
      return 'Speak to see audio levels';
    } else if (this.microphoneStatus() === 'testing') {
      return 'Accessing microphone...';
    } else if (this.microphoneStatus() === 'error') {
      return 'Microphone access denied';
    }
    return 'Click "Test Microphone" to begin';
  }

  async testMicrophone() {
    this.microphoneStatus.set('testing');

    try {
      const connected = await this.ensureConnected();
      if (!connected) {
        this.microphoneStatus.set('error');
        this.updateSystemStatus();
        return;
      }

      await this.livekitService.enableMicrophone(true);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Microphone test failed';
      this.toasterService.show('error', 'Microphone Error', message);
      this.microphoneStatus.set('error');
      this.updateSystemStatus();
    }
  }

  async stopMicrophone() {
    this.stopAudioVisualization();
    try {
      await this.livekitService.enableMicrophone(false);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to stop microphone';
      this.toasterService.show('error', 'Microphone Error', message);
    }
    this.microphoneStatus.set('idle');
    this.updateSystemStatus();
  }

  private setupAudioVisualization(track: LocalAudioTrack) {
    this.stopAudioVisualization();
    try {
      const mediaStream = new MediaStream([track.mediaStreamTrack]);
      this.audioContext = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
      const source = this.audioContext.createMediaStreamSource(mediaStream);
      this.analyserNode = this.audioContext.createAnalyser();
      this.analyserNode.fftSize = 64;
      source.connect(this.analyserNode);

      this.visualizeAudio();
    } catch (error) {
      this.toasterService.show('error', 'Audio Error', 'Audio visualization setup failed');
    }
  }

  private visualizeAudio() {
    if (!this.analyserNode) return;

    const bufferLength = this.analyserNode.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);

    const analyze = () => {
      if (!this.analyserNode || this.microphoneStatus() !== 'working') return;

      this.analyserNode.getByteFrequencyData(dataArray);

      const bars = Array.from({ length: 20 }, (_, i) => {
        const dataIndex = Math.floor(i * bufferLength / 20);
        return (dataArray[dataIndex] / 255) * 100;
      });

      this.volumeBars.set(bars);
      this.animationFrame = requestAnimationFrame(analyze);
    };

    analyze();
  }

  private stopAudioVisualization() {
    if (this.audioContext) {
      this.audioContext.close();
      this.audioContext = null;
      this.analyserNode = null;
    }

    if (this.animationFrame) {
      cancelAnimationFrame(this.animationFrame);
      this.animationFrame = null;
    }

    this.volumeBars.set(Array(20).fill(0));
  }

  getSpeakerStatusText(): string {
    switch (this.speakerStatus()) {
      case 'idle':
        return 'Not tested';
      case 'playing':
        return 'Playing';
      case 'working':
        return 'Working';
      case 'error':
        return 'Error';
      default:
        return 'Unknown';
    }
  }

  getSpeakerInfoText(): string {
    if (this.speakerStatus() === 'playing') {
      return 'Playing test sound... Can you hear it?';
    } else if (this.speakerStatus() === 'working') {
      return 'Speakers are working correctly';
    } else if (this.speakerStatus() === 'error') {
      return 'Speaker test failed';
    }
    return 'Click "Test Speakers" to play a test sound';
  }

  testSpeakers() {
    this.speakerStatus.set('playing');

    try {
      this.testAudio = new Audio();
      this.testAudio.src = this.generateTestTone();
      this.testAudio.play()
        .then(() => {
          setTimeout(() => {
            if (this.speakerStatus() === 'playing') {
              this.speakerStatus.set('idle');
            }
          }, 3000);
        })
        .catch(() => {
          this.toasterService.show('error', 'Speaker Error', 'Failed to play test sound');
          this.speakerStatus.set('error');
          this.updateSystemStatus();
        });
    } catch (error) {
      this.toasterService.show('error', 'Speaker Error', 'Speaker test setup failed');
      this.speakerStatus.set('error');
      this.updateSystemStatus();
    }
  }

  confirmSpeakers() {
    if (this.testAudio) {
      this.testAudio.pause();
      this.testAudio = null;
    }

    this.speakerStatus.set('working');
    this.updateSystemStatus();
  }

  private generateTestTone(): string {
    const sampleRate = 44100;
    const duration = 2;
    const frequency = 440;
    const samples = duration * sampleRate;
    const buffer = new ArrayBuffer(44 + samples * 2);
    const view = new DataView(buffer);

    const writeString = (offset: number, string: string) => {
      for (let i = 0; i < string.length; i++) {
        view.setUint8(offset + i, string.charCodeAt(i));
      }
    };

    writeString(0, 'RIFF');
    view.setUint32(4, 36 + samples * 2, true);
    writeString(8, 'WAVE');
    writeString(12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, 1, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * 2, true);
    view.setUint16(32, 2, true);
    view.setUint16(34, 16, true);
    writeString(36, 'data');
    view.setUint32(40, samples * 2, true);

    let offset = 44;
    for (let i = 0; i < samples; i++) {
      const sample = Math.sin(2 * Math.PI * frequency * i / sampleRate) * 0.3;
      view.setInt16(offset, sample * 0x7FFF, true);
      offset += 2;
    }

    const blob = new Blob([buffer], { type: 'audio/wav' });
    return URL.createObjectURL(blob);
  }

  getConnectionStatusText(): string {
    switch (this.connectionStatus()) {
      case 'disconnected':
        return 'Not connected';
      case 'connecting':
        return 'Connecting...';
      case 'connected':
        return 'Connected';
      case 'reconnecting':
        return 'Reconnecting...';
      case 'failed':
        return 'Connection failed';
      default:
        return 'Unknown';
    }
  }

  getConnectionStatusColor(): string {
    switch (this.connectionStatus()) {
      case 'connected':
        return 'var(--Success-05)';
      case 'connecting':
      case 'reconnecting':
        return 'var(--Warning-05)';
      case 'failed':
        return 'var(--Error-05)';
      default:
        return 'var(--Bluish-Gray-06)';
    }
  }

  allTestsCompleted(): boolean {
    return this.cameraStatus() === 'working' &&
           this.microphoneStatus() === 'working' &&
           this.speakerStatus() === 'working';
  }

  getOverallStatusText(): string {
    if (this.allTestsCompleted()) {
      return 'All systems ready for consultations';
    }

    const working = [this.cameraStatus(), this.microphoneStatus(), this.speakerStatus()]
      .filter(status => status === 'working').length;

    return `${working}/3 systems tested and working`;
  }

  getOverallStatusColor(): string {
    if (this.allTestsCompleted()) {
      return 'var(--Success-05)';
    }

    const working = [this.cameraStatus(), this.microphoneStatus(), this.speakerStatus()]
      .filter(status => status === 'working').length;

    if (working === 0) {
      return 'var(--Error-05)';
    }

    return 'var(--Warning-05)';
  }

  async testAllSystems() {
    const connected = await this.ensureConnected();
    if (!connected) {
      return;
    }

    if (this.cameraStatus() === 'idle') {
      await this.testCamera();
    }

    if (this.microphoneStatus() === 'idle') {
      await this.testMicrophone();
    }

    if (this.speakerStatus() === 'idle') {
      this.testSpeakers();
    }
  }

  startConsultations() {
    if (this.allTestsCompleted()) {
      this.router.navigate(['/user/consultations']);
    }
  }

  private cleanup() {
    if (this.localVideoTrack && this.videoElement?.nativeElement) {
      this.localVideoTrack.detach(this.videoElement.nativeElement);
    }

    this.stopAudioVisualization();

    if (this.testAudio) {
      this.testAudio.pause();
      this.testAudio = null;
    }

    this.livekitService.disconnect();
  }
}
