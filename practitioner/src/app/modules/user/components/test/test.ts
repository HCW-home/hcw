import { Component, OnInit, OnDestroy, signal, ViewChild, ElementRef, inject } from '@angular/core';
import { Page } from '../../../../core/components/page/page';
import { Breadcrumb } from '../../../../shared/components/breadcrumb/breadcrumb';
import { Button } from '../../../../shared/ui-components/button/button';
import { Typography } from '../../../../shared/ui-components/typography/typography';
import { Svg } from '../../../../shared/ui-components/svg/svg';
import {
  ButtonSizeEnum,
  ButtonStyleEnum,
} from '../../../../shared/constants/button';
import { TypographyTypeEnum } from '../../../../shared/constants/typography';
import { Router } from '@angular/router';

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

  cameraStatus = signal<TestStatus>('idle');
  microphoneStatus = signal<TestStatus>('idle');
  speakerStatus = signal<TestStatus>('idle');
  systemStatus = signal<'checking' | 'ready' | 'partial' | 'error'>('checking');

  private videoStream: MediaStream | null = null;
  private audioStream: MediaStream | null = null;
  private audioContext: AudioContext | null = null;
  private analyserNode: AnalyserNode | null = null;
  private animationFrame: number | null = null;
  private testAudio: HTMLAudioElement | null = null;

  volumeBars = signal<number[]>(Array(20).fill(0));
  soundWaves = signal<number[]>(Array(5).fill(0));

  protected readonly ButtonSizeEnum = ButtonSizeEnum;
  protected readonly ButtonStyleEnum = ButtonStyleEnum;
  protected readonly TypographyTypeEnum = TypographyTypeEnum;

  private router = inject(Router);

  constructor() {}

  ngOnInit() {
    this.updateSystemStatus();
  }

  ngOnDestroy() {
    this.cleanup();
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

    if (camera === 'working' && mic === 'working' && speaker === 'working') {
      this.systemStatus.set('ready');
    } else if (camera === 'error' && mic === 'error' && speaker === 'error') {
      this.systemStatus.set('error');
    } else if (camera === 'working' || mic === 'working' || speaker === 'working') {
      this.systemStatus.set('partial');
    } else {
      this.systemStatus.set('checking');
    }
  }

  // Camera Methods
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
      this.stopCamera();

      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          width: { ideal: 640 },
          height: { ideal: 480 },
          facingMode: 'user'
        }
      });

      this.videoStream = stream;

      await new Promise<void>((resolve, reject) => {
        const checkVideo = () => {
          if (this.videoElement?.nativeElement) {
            const video = this.videoElement.nativeElement;
            video.srcObject = stream;

            video.onloadedmetadata = () => {
              video.play().then(() => {
                this.cameraStatus.set('working');
                this.updateSystemStatus();
                resolve();
              }).catch(reject);
            };

            video.onerror = reject;
          } else {
            setTimeout(checkVideo, 50);
          }
        };
        checkVideo();
      });

    } catch (error) {
      console.error('Camera test failed:', error);
      this.cameraStatus.set('error');
      this.updateSystemStatus();

      // Clean up on error
      if (this.videoStream) {
        this.videoStream.getTracks().forEach(track => track.stop());
        this.videoStream = null;
      }
    }
  }

  stopCamera() {
    if (this.videoStream) {
      this.videoStream.getTracks().forEach(track => track.stop());
      this.videoStream = null;

      if (this.videoElement?.nativeElement) {
        this.videoElement.nativeElement.srcObject = null;
      }
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
      this.stopMicrophone();

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        }
      });

      this.audioStream = stream;
      await this.setupAudioVisualization(stream);
      this.microphoneStatus.set('working');
      this.updateSystemStatus();
    } catch (error) {
      console.error('Microphone test failed:', error);
      this.microphoneStatus.set('error');
      this.updateSystemStatus();

      if (this.audioStream) {
        this.audioStream.getTracks().forEach(track => track.stop());
        this.audioStream = null;
      }
    }
  }

  stopMicrophone() {
    if (this.audioStream) {
      this.audioStream.getTracks().forEach(track => track.stop());
      this.audioStream = null;
    }

    if (this.audioContext) {
      this.audioContext.close();
      this.audioContext = null;
    }

    if (this.animationFrame) {
      cancelAnimationFrame(this.animationFrame);
      this.animationFrame = null;
    }

    this.volumeBars.set(Array(20).fill(0));
    this.microphoneStatus.set('idle');
    this.updateSystemStatus();
  }

  private setupAudioVisualization(stream: MediaStream) {
    try {
      this.audioContext = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
      const source = this.audioContext.createMediaStreamSource(stream);
      this.analyserNode = this.audioContext.createAnalyser();
      this.analyserNode.fftSize = 64;
      source.connect(this.analyserNode);

      this.visualizeAudio();
    } catch (error) {
      console.error('Audio visualization setup failed:', error);
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

  // Speaker Methods
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

    // Create a test tone
    try {
      this.testAudio = new Audio();
      // Generate a simple test tone using data URL
      this.testAudio.src = this.generateTestTone();
      this.testAudio.play()
        .then(() => {
          // Audio is playing
          setTimeout(() => {
            if (this.speakerStatus() === 'playing') {
              this.speakerStatus.set('idle');
            }
          }, 3000); // 3 second test tone
        })
        .catch((error) => {
          console.error('Speaker test failed:', error);
          this.speakerStatus.set('error');
          this.updateSystemStatus();
        });
    } catch (error) {
      console.error('Speaker test setup failed:', error);
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
    // Generate a simple test tone at 440Hz (A4 note)
    const sampleRate = 44100;
    const duration = 2; // 2 seconds
    const frequency = 440; // A4
    const samples = duration * sampleRate;
    const buffer = new ArrayBuffer(44 + samples * 2);
    const view = new DataView(buffer);

    // WAV header
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

    // Generate sine wave
    let offset = 44;
    for (let i = 0; i < samples; i++) {
      const sample = Math.sin(2 * Math.PI * frequency * i / sampleRate) * 0.3; // 30% volume
      view.setInt16(offset, sample * 0x7FFF, true);
      offset += 2;
    }

    const blob = new Blob([buffer], { type: 'audio/wav' });
    return URL.createObjectURL(blob);
  }

  // Overall Status Methods
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

  // Action Methods
  testAllSystems() {
    if (this.cameraStatus() === 'idle') {
      this.testCamera();
    }

    setTimeout(() => {
      if (this.microphoneStatus() === 'idle') {
        this.testMicrophone();
      }
    }, 1000);

    setTimeout(() => {
      if (this.speakerStatus() === 'idle') {
        this.testSpeakers();
      }
    }, 2000);
  }

  startConsultations() {
    if (this.allTestsCompleted()) {
      this.router.navigate(['/user/consultations']);
    }
  }


  private cleanup() {
    this.stopCamera();
    this.stopMicrophone();

    if (this.testAudio) {
      this.testAudio.pause();
      this.testAudio = null;
    }
  }
}
