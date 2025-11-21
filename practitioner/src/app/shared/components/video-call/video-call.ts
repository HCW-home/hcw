import { Component, OnInit, OnDestroy, Input, Output, EventEmitter, ViewChild, ElementRef, AfterViewInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Subject, takeUntil } from 'rxjs';
import { WebRTCService } from '../../../core/services/webrtc.service';
import { LocalStream, RemoteStream } from '../../../core/models/webrtc';
import { Button } from '../../ui-components/button/button';
import { Typography } from '../../ui-components/typography/typography';
import { Svg } from '../../ui-components/svg/svg';
import { TypographyTypeEnum } from '../../constants/typography';
import { ButtonSizeEnum, ButtonStyleEnum, ButtonStateEnum } from '../../constants/button';

@Component({
  selector: 'app-video-call',
  imports: [CommonModule, Button, Typography, Svg],
  templateUrl: './video-call.html',
  styleUrl: './video-call.scss',
})
export class VideoCall implements OnInit, AfterViewInit, OnDestroy {
  @Input() consultationId!: number;
  @Input() displayName = 'User';
  @Output() callEnded = new EventEmitter<void>();

  @ViewChild('localVideo') localVideoRef?: ElementRef<HTMLVideoElement>;

  private destroy$ = new Subject<void>();

  localStream: LocalStream | null = null;
  remoteStreams: RemoteStream[] = [];
  isPublishing = false;
  isAudioEnabled = true;
  isVideoEnabled = true;
  error: string | null = null;

  protected readonly TypographyTypeEnum = TypographyTypeEnum;
  protected readonly ButtonSizeEnum = ButtonSizeEnum;
  protected readonly ButtonStyleEnum = ButtonStyleEnum;
  protected readonly ButtonStateEnum = ButtonStateEnum;

  constructor(private webrtcService: WebRTCService) {}

  ngOnInit(): void {
    this.webrtcService.localStream$
      .pipe(takeUntil(this.destroy$))
      .subscribe(stream => {
        this.localStream = stream;
        if (stream) {
          this.isAudioEnabled = stream.audioEnabled;
          this.isVideoEnabled = stream.videoEnabled;
          this.attachLocalStream();
        }
      });

    this.webrtcService.remoteStreams$
      .pipe(takeUntil(this.destroy$))
      .subscribe(streams => {
        this.remoteStreams = streams;
        setTimeout(() => this.attachRemoteStreams(), 100);
      });

    this.webrtcService.isPublishing$
      .pipe(takeUntil(this.destroy$))
      .subscribe(publishing => {
        this.isPublishing = publishing;
      });

    this.webrtcService.error$
      .pipe(takeUntil(this.destroy$))
      .subscribe(error => {
        this.error = error;
      });
  }

  ngAfterViewInit(): void {
    this.attachLocalStream();
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  private attachLocalStream(): void {
    if (this.localVideoRef && this.localStream) {
      const video = this.localVideoRef.nativeElement;
      video.srcObject = this.localStream.stream;
      video.muted = true;
      video.play().catch(err => console.error('Error playing local video:', err));
    }
  }

  private attachRemoteStreams(): void {
    this.remoteStreams.forEach(remote => {
      const videoElement = document.getElementById(`remote-video-${remote.feedId}`) as HTMLVideoElement;
      if (videoElement && videoElement.srcObject !== remote.stream) {
        videoElement.srcObject = remote.stream;
        videoElement.play().catch(err => console.error('Error playing remote video:', err));
      }
    });
  }

  toggleAudio(): void {
    this.webrtcService.toggleAudio();
  }

  toggleVideo(): void {
    this.webrtcService.toggleVideo();
  }

  endCall(): void {
    this.webrtcService.cleanup();
    this.callEnded.emit();
  }

  trackByFeedId(index: number, item: RemoteStream): number {
    return item.feedId;
  }
}
