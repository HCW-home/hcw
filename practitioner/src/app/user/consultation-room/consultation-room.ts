import { Component, OnInit, OnDestroy, ElementRef, ViewChild } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { ConsultationService, Consultation, ConsultationMessage } from '../../core/services/consultation.service';
import { AuthService } from '../../core/services/auth.service';
import { VideoRoomService, VideoRoomEvent, VideoRoomParticipant } from '../../core/services/video-room.service';
import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatDividerModule } from '@angular/material/divider';
import { MatChipsModule } from '@angular/material/chips';
import { MatToolbarModule } from '@angular/material/toolbar';
import { MatSidenavModule } from '@angular/material/sidenav';
import { MatListModule } from '@angular/material/list';
import { FormsModule } from '@angular/forms';
import { AsyncPipe, CommonModule, KeyValuePipe } from '@angular/common';
import { Subscription } from 'rxjs';
import { firstValueFrom } from 'rxjs';
import { MatTooltipModule } from '@angular/material/tooltip';

@Component({
  selector: 'app-consultation-room',
  templateUrl: './consultation-room.html',
  imports: [
    MatCardModule,
    MatButtonModule,
    MatIconModule,
    MatInputModule,
    MatFormFieldModule,
    MatDividerModule,
    MatChipsModule,
    MatToolbarModule,
    MatSidenavModule,
    MatListModule,
    FormsModule,
    MatTooltipModule,
    AsyncPipe,
    CommonModule,
    KeyValuePipe
  ],
  styleUrl: './consultation-room.scss'
})
export class ConsultationRoomComponent implements OnInit, OnDestroy {
  @ViewChild('localVideo') localVideoRef!: ElementRef<HTMLVideoElement>;
  @ViewChild('remoteVideo') remoteVideoRef!: ElementRef<HTMLVideoElement>;

  consultationId: number = 0;
  consultation: Consultation | null = null;
  messages: ConsultationMessage[] = [];
  newMessage: string = '';
  chatOpen = true;

  // Video call state
  isVideoEnabled = false;
  isAudioEnabled = false;
  isInCall = false;
  isConnecting = false;
  participants: VideoRoomParticipant[] = [];
  remoteStreams: Map<number, MediaStream> = new Map();

  private subscriptions: Subscription[] = [];

  constructor(
    private route: ActivatedRoute,
    private router: Router,
    private consultationService: ConsultationService,
    private videoRoomService: VideoRoomService,
    public authService: AuthService
  ) {}

  ngOnInit(): void {
    this.consultationId = Number(this.route.snapshot.paramMap.get('id'));
    this.loadConsultation();
    this.initializeVideoRoom();
    this.connectToWebSocket();
  }

  ngOnDestroy(): void {
    this.subscriptions.forEach(sub => sub.unsubscribe());
    this.leaveVideoRoom();
    this.consultationService.disconnect();
  }

  loadConsultation(): void {
    // Load consultation details
    this.consultationService.getConsultations().subscribe(consultations => {
      this.consultation = consultations.find(c => c.id === this.consultationId) || null;
    });
  }

  connectToWebSocket(): void {
    this.consultationService.connectToConsultation(this.consultationId);

    // Subscribe to messages
    const messagesSub = this.consultationService.messages$.subscribe(messages => {
      this.messages = messages;
      setTimeout(() => this.scrollToBottom(), 100);
    });

    // Forward video messages from consultation service to video room service
    const videoMessageHandler = (data: any) => {
      // Check if this is a video-related message
      if (this.isVideoMessage(data)) {
        this.videoRoomService.handleVideoMessage(data);
      }
    };

    // Subscribe to raw WebSocket messages for video events
    this.consultationService.onWebSocketMessage = videoMessageHandler;

    this.subscriptions.push(messagesSub);
  }

  private isVideoMessage(data: any): boolean {
    const videoMessageTypes = ['room_created', 'janus_event', 'participants', 'ice_config', 'joined', 'error'];
    return videoMessageTypes.includes(data.type);
  }

  private initializeVideoRoom(): void {
    // Subscribe to video room events
    const videoRoomEventsSub = this.videoRoomService.events.subscribe(
      (event: VideoRoomEvent) => this.handleVideoRoomEvent(event)
    );

    const participantsSub = this.videoRoomService.participants.subscribe(
      (participants: VideoRoomParticipant[]) => {
        this.participants = participants;
      }
    );

    this.subscriptions.push(videoRoomEventsSub, participantsSub);
  }

  private handleVideoRoomEvent(event: VideoRoomEvent): void {
    console.log('VideoRoom event:', event);

    switch (event.type) {
      case 'joined':
        console.log('Successfully joined video room');
        break;
      case 'published':
        if (event.stream && event.participant) {
          this.handleRemoteStream(event.participant.id, event.stream);
        }
        break;
      case 'unpublished':
        if (event.participant) {
          this.removeRemoteStream(event.participant.id);
        }
        break;
      case 'left':
        if (event.participant) {
          this.removeRemoteStream(event.participant.id);
        }
        break;
    }
  }

  private handleRemoteStream(participantId: number, stream: MediaStream): void {
    console.log('📺 Handling remote stream for participant:', participantId);
    this.remoteStreams.set(participantId, stream);

    // Set the stream to the specific video element after the view updates
    setTimeout(() => {
      const videoElement = document.getElementById(`remote-video-${participantId}`) as HTMLVideoElement;
      if (videoElement) {
        videoElement.srcObject = stream;
        console.log('📺 Set remote video for participant:', participantId);
      }
    }, 100);
  }

  private removeRemoteStream(participantId: number): void {
    this.remoteStreams.delete(participantId);

    // If this was the stream being displayed, clear it
    if (this.remoteVideoRef && this.remoteStreams.size === 0) {
      this.remoteVideoRef.nativeElement.srcObject = null;
    }
  }

  sendMessage(): void {
    if (!this.newMessage.trim()) return;

    this.consultationService.sendMessage(this.newMessage);
    this.newMessage = '';
  }

  toggleChat(): void {
    this.chatOpen = !this.chatOpen;
  }

  // Video call methods
  async startVideoCall(): Promise<void> {
    try {
      this.isConnecting = true;

      // Room is already created when WebSocket connects
      // Just join the room and start publishing
      const currentUser = await firstValueFrom(this.authService.currentUser$);
      const displayName = currentUser?.first_name || 'Practitioner';
      await this.videoRoomService.joinRoom(displayName);

      // Start publishing video/audio
      await this.videoRoomService.startPublishing(true, true);

      // Set local video stream
      const localStream = this.videoRoomService.getLocalStream();
      if (localStream && this.localVideoRef) {
        this.localVideoRef.nativeElement.srcObject = localStream;
      }

      this.isVideoEnabled = true;
      this.isAudioEnabled = true;
      this.isInCall = true;
      this.isConnecting = false;

    } catch (error) {
      console.error('Error starting video call:', error);
      this.isConnecting = false;
    }
  }

  async stopVideoCall(): Promise<void> {
    try {
      await this.videoRoomService.stopPublishing();
      this.isInCall = false;
      this.isVideoEnabled = false;
      this.isAudioEnabled = false;

      // Clear local video
      if (this.localVideoRef) {
        this.localVideoRef.nativeElement.srcObject = null;
      }
    } catch (error) {
      console.error('Error stopping video call:', error);
    }
  }

  async toggleVideo(): Promise<void> {
    try {
      await this.videoRoomService.toggleVideo();
      this.isVideoEnabled = !this.isVideoEnabled;
    } catch (error) {
      console.error('Error toggling video:', error);
    }
  }

  async toggleAudio(): Promise<void> {
    try {
      await this.videoRoomService.toggleAudio();
      this.isAudioEnabled = !this.isAudioEnabled;
    } catch (error) {
      console.error('Error toggling audio:', error);
    }
  }

  private async leaveVideoRoom(): Promise<void> {
    try {
      await this.videoRoomService.disconnect();
    } catch (error) {
      console.error('Error leaving video room:', error);
    }
  }

  private scrollToBottom(): void {
    const chatContainer = document.querySelector('.chat-messages');
    if (chatContainer) {
      chatContainer.scrollTop = chatContainer.scrollHeight;
    }
  }

  async leaveConsultation(): Promise<void> {
    await this.leaveVideoRoom();
    this.consultationService.disconnect();
    this.router.navigate(['/user/consultations']);
  }

  formatMessageTime(timestamp: string): string {
    return new Date(timestamp).toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit'
    });
  }

  getParticipantName(participantId: number): string {
    const participant = this.participants.find(p => p.id === participantId);
    return participant?.display || `Participant ${participantId}`;
  }
}
