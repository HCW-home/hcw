import {
  Component,
  OnInit,
  OnDestroy,
  Input,
  Output,
  EventEmitter,
  ElementRef,
  ViewChild,
  AfterViewInit,
  ChangeDetectionStrategy,
  ChangeDetectorRef,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import { LocalVideoTrack } from 'livekit-client';

import { LiveKitService, ParticipantInfo, ConnectionStatus } from '../../../../core/services/livekit.service';
import { ConsultationService } from '../../../../core/services/consultation.service';
import { ToasterService } from '../../../../core/services/toaster.service';
import { Button } from '../../../../shared/ui-components/button/button';
import { Svg } from '../../../../shared/ui-components/svg/svg';
import { Typography } from '../../../../shared/ui-components/typography/typography';
import { Loader } from '../../../../shared/components/loader/loader';
import { TypographyTypeEnum } from '../../../../shared/constants/typography';
import { ButtonStyleEnum } from '../../../../shared/constants/button';

@Component({
  selector: 'app-video-consultation',
  standalone: true,
  imports: [
    CommonModule,
    Button,
    Svg,
    Typography,
    Loader,
  ],
  templateUrl: './video-consultation.html',
  styleUrls: ['./video-consultation.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class VideoConsultationComponent implements OnInit, OnDestroy, AfterViewInit {
  @Input() consultationId?: number;
  @Input() appointmentId?: number;
  @Output() leave = new EventEmitter<void>();

  @ViewChild('localVideo') localVideoRef!: ElementRef<HTMLVideoElement>;
  @ViewChild('participantsContainer') participantsContainerRef!: ElementRef<HTMLDivElement>;

  connectionStatus: ConnectionStatus = 'disconnected';
  participants: Map<string, ParticipantInfo> = new Map();
  localVideoTrack: LocalVideoTrack | null = null;
  isCameraEnabled = false;
  isMicrophoneEnabled = false;
  isScreenShareEnabled = false;
  isLoading = false;
  errorMessage = '';

  protected readonly TypographyTypeEnum = TypographyTypeEnum;
  protected readonly ButtonStyleEnum = ButtonStyleEnum;

  private destroy$ = new Subject<void>();
  private videoElements = new Map<string, HTMLVideoElement>();
  private audioElements = new Map<string, HTMLAudioElement>();

  constructor(
    private livekitService: LiveKitService,
    private consultationService: ConsultationService,
    private toasterService: ToasterService,
    private cdr: ChangeDetectorRef
  ) {}

  ngOnInit(): void {
    this.setupSubscriptions();
  }

  ngAfterViewInit(): void {
    this.joinRoom();
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
    this.livekitService.disconnect();
    this.cleanupMediaElements();
  }

  private setupSubscriptions(): void {
    this.livekitService.connectionStatus$
      .pipe(takeUntil(this.destroy$))
      .subscribe(status => {
        this.connectionStatus = status;
        this.cdr.markForCheck();
      });

    this.livekitService.localVideoTrack$
      .pipe(takeUntil(this.destroy$))
      .subscribe(track => {
        this.localVideoTrack = track;
        this.attachLocalVideo();
        this.cdr.markForCheck();
      });

    this.livekitService.participants$
      .pipe(takeUntil(this.destroy$))
      .subscribe(participants => {
        this.participants = participants;
        this.attachRemoteMedia();
        this.cdr.markForCheck();
      });

    this.livekitService.isCameraEnabled$
      .pipe(takeUntil(this.destroy$))
      .subscribe(enabled => {
        this.isCameraEnabled = enabled;
        this.cdr.markForCheck();
      });

    this.livekitService.isMicrophoneEnabled$
      .pipe(takeUntil(this.destroy$))
      .subscribe(enabled => {
        this.isMicrophoneEnabled = enabled;
        this.cdr.markForCheck();
      });

    this.livekitService.isScreenShareEnabled$
      .pipe(takeUntil(this.destroy$))
      .subscribe(enabled => {
        this.isScreenShareEnabled = enabled;
        this.cdr.markForCheck();
      });

    this.livekitService.error$
      .pipe(takeUntil(this.destroy$))
      .subscribe(error => {
        this.errorMessage = error;
        this.toasterService.show('error', 'Error', error);
        this.cdr.markForCheck();
      });
  }

  private async joinRoom(): Promise<void> {
    this.isLoading = true;
    this.errorMessage = '';
    this.cdr.markForCheck();

    try {
      let config: { url: string; token: string; room: string } | undefined;

      if (this.appointmentId) {
        config = await this.consultationService
          .joinAppointment(this.appointmentId)
          .toPromise();
      } else if (this.consultationId) {
        config = await this.consultationService
          .joinConsultation(this.consultationId)
          .toPromise();
      } else {
        throw new Error('Either consultationId or appointmentId is required');
      }

      if (!config) {
        throw new Error('Failed to get LiveKit configuration');
      }

      await this.livekitService.connect(config);
      await this.livekitService.enableCamera(true);
      await this.livekitService.enableMicrophone(true);
    } catch (error) {
      this.errorMessage = error instanceof Error ? error.message : 'Failed to join video call';
      this.toasterService.show('error', 'Connection Error', this.errorMessage);
    } finally {
      this.isLoading = false;
      this.cdr.markForCheck();
    }
  }

  private attachLocalVideo(): void {
    if (!this.localVideoRef?.nativeElement || !this.localVideoTrack) return;

    this.localVideoTrack.attach(this.localVideoRef.nativeElement);
  }

  private attachRemoteMedia(): void {
    if (!this.participantsContainerRef?.nativeElement) return;

    const currentParticipantIds = new Set(this.participants.keys());
    const existingElementIds = new Set(this.videoElements.keys());

    for (const id of existingElementIds) {
      if (!currentParticipantIds.has(id)) {
        this.removeParticipantElements(id);
      }
    }

    for (const [identity, participant] of this.participants) {
      this.attachParticipantMedia(identity, participant);
    }
  }

  private attachParticipantMedia(identity: string, participant: ParticipantInfo): void {
    if (participant.videoTrack) {
      let videoEl = this.videoElements.get(identity);
      if (!videoEl) {
        videoEl = document.createElement('video');
        videoEl.autoplay = true;
        videoEl.playsInline = true;
        videoEl.className = 'participant-video';
        videoEl.id = `video-${identity}`;
        this.videoElements.set(identity, videoEl);
      }

      if (participant.videoTrack.attachedElements.indexOf(videoEl) === -1) {
        participant.videoTrack.attach(videoEl);
      }
    }

    if (participant.audioTrack) {
      let audioEl = this.audioElements.get(identity);
      if (!audioEl) {
        audioEl = document.createElement('audio');
        audioEl.autoplay = true;
        audioEl.id = `audio-${identity}`;
        this.audioElements.set(identity, audioEl);
      }

      if (participant.audioTrack.attachedElements.indexOf(audioEl) === -1) {
        participant.audioTrack.attach(audioEl);
      }
    }
  }

  private removeParticipantElements(identity: string): void {
    const videoEl = this.videoElements.get(identity);
    if (videoEl) {
      videoEl.srcObject = null;
      videoEl.remove();
      this.videoElements.delete(identity);
    }

    const audioEl = this.audioElements.get(identity);
    if (audioEl) {
      audioEl.srcObject = null;
      audioEl.remove();
      this.audioElements.delete(identity);
    }
  }

  private cleanupMediaElements(): void {
    for (const [identity] of this.videoElements) {
      this.removeParticipantElements(identity);
    }
    this.videoElements.clear();
    this.audioElements.clear();
  }

  async toggleCamera(): Promise<void> {
    try {
      await this.livekitService.toggleCamera();
    } catch (error) {
      this.toasterService.show('error', 'Camera Error', 'Failed to toggle camera');
    }
  }

  async toggleMicrophone(): Promise<void> {
    try {
      await this.livekitService.toggleMicrophone();
    } catch (error) {
      this.toasterService.show('error', 'Microphone Error', 'Failed to toggle microphone');
    }
  }

  async toggleScreenShare(): Promise<void> {
    try {
      await this.livekitService.toggleScreenShare();
    } catch (error) {
      this.toasterService.show('error', 'Screen Share Error', 'Failed to toggle screen share');
    }
  }

  async leaveCall(): Promise<void> {
    await this.livekitService.disconnect();
    this.leave.emit();
  }

  getParticipantsArray(): ParticipantInfo[] {
    return Array.from(this.participants.values());
  }

  getParticipantVideoElement(identity: string): HTMLVideoElement | undefined {
    return this.videoElements.get(identity);
  }

  trackByIdentity(index: number, participant: ParticipantInfo): string {
    return participant.identity;
  }
}
