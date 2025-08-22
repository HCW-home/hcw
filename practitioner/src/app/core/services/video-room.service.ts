import { Injectable } from '@angular/core';
import { BehaviorSubject, Subject } from 'rxjs';
import { ConsultationService } from './consultation.service';

export interface VideoRoomParticipant {
  id: number;
  display?: string;
  publisher: boolean;
  talking?: boolean;
}

export interface VideoRoomEvent {
  type: 'joined' | 'left' | 'published' | 'unpublished' | 'talking' | 'stopped-talking' | 'room_created';
  participant?: VideoRoomParticipant;
  stream?: MediaStream;
  roomId?: number;
}

@Injectable({
  providedIn: 'root'
})
export class VideoRoomService {
  private localStream: MediaStream | null = null;
  private remoteStreams: Map<number, MediaStream> = new Map();
  private publisherPc: RTCPeerConnection | null = null;  // For publishing
  private subscriberPcs: Map<number, RTCPeerConnection> = new Map(); // For each subscriber

  private participants$ = new BehaviorSubject<VideoRoomParticipant[]>([]);
  private events$ = new Subject<VideoRoomEvent>();

  // Public observables
  public readonly participants = this.participants$.asObservable();
  public readonly events = this.events$.asObservable();

  private roomId: number | null = null;
  private isRoomCreated = false;

  constructor(private consultationService: ConsultationService) {}

  async joinRoom(displayName: string): Promise<void> {
    console.log(`🚪 Joining room as "${displayName}"`);

    // Send join message through consultation service
    this.consultationService.sendVideoMessage({
      type: 'join',
      data: {
        display_name: displayName
      }
    });

    this.events$.next({ type: 'joined' });
  }

  async startPublishing(video: boolean = true, audio: boolean = true): Promise<void> {
    try {
      console.log('🎥 Getting user media and starting to publish...');

      // Get user media
      this.localStream = await navigator.mediaDevices.getUserMedia({
        video: video,
        audio: audio
      });

      // Create RTCPeerConnection for publishing
      // TEMPORARY: Using TURN in frontend for testing until Janus server is configured
      this.publisherPc = new RTCPeerConnection({
        iceServers: [
          { urls: 'stun:stun.l.google.com:19302' },
          { 
            urls: 'turn:demo.hcw-at-home.com:3478',
            username: 'iabsis',
            credential: 'pfcqopfs'
          }
        ],
        iceCandidatePoolSize: 10
      });

      // Add local stream to peer connection
      this.localStream.getTracks().forEach(track => {
        this.publisherPc!.addTrack(track, this.localStream!);
      });

      // Handle ICE candidates
      this.publisherPc.onicecandidate = (event) => {
        if (event.candidate) {
          this.consultationService.sendVideoMessage({
            type: 'trickle',
            data: {
              candidate: {
                candidate: event.candidate.candidate,
                sdpMid: event.candidate.sdpMid,
                sdpMLineIndex: event.candidate.sdpMLineIndex
              }
            }
          });
        } else {
          // End of candidates
          this.consultationService.sendVideoMessage({
            type: 'trickle',
            data: {
              candidate: null
            }
          });
        }
      };

      // Monitor ICE connection state
      this.publisherPc.oniceconnectionstatechange = () => {
        const state = this.publisherPc?.iceConnectionState;
        console.log('🧊 Publisher ICE connection state:', state);
        
        if (state === 'failed' || state === 'disconnected') {
          console.warn('⚠️ Publisher ICE connection failed/disconnected');
        } else if (state === 'connected' || state === 'completed') {
          console.log('✅ Publisher ICE connection established');
        }
      };

      // Monitor general connection state
      this.publisherPc.onconnectionstatechange = () => {
        const state = this.publisherPc?.connectionState;
        console.log('🔗 Publisher connection state:', state);
        
        if (state === 'failed') {
          console.error('❌ Publisher connection failed');
        } else if (state === 'connected') {
          console.log('✅ Publisher connection established');
        }
      };

      // Create offer
      const offer = await this.publisherPc.createOffer();
      await this.publisherPc.setLocalDescription(offer);

      console.log('📤 Sending publish with offer:', offer);

      // Send publish message
      this.consultationService.sendVideoMessage({
        type: 'publish',
        data: {
          jsep: {
            type: offer.type,
            sdp: offer.sdp
          }
        }
      });

      this.events$.next({ type: 'published' });

    } catch (error) {
      console.error('Error starting publishing:', error);
      throw error;
    }
  }

  async stopPublishing(): Promise<void> {
    if (this.localStream) {
      this.localStream.getTracks().forEach(track => track.stop());
      this.localStream = null;
    }

    if (this.publisherPc) {
      this.publisherPc.close();
      this.publisherPc = null;
    }

    this.events$.next({ type: 'unpublished' });
  }

  async subscribeToFeed(feedId: number): Promise<void> {
    console.log('📺 Subscribing to feed:', feedId);

    // Create a new peer connection for this subscriber
    // TEMPORARY: Using TURN in frontend for testing until Janus server is configured
    const subscriberPc = new RTCPeerConnection({
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { 
          urls: 'turn:demo.hcw-at-home.com:3478',
          username: 'iabsis',
          credential: 'pfcqopfs'
        }
      ],
      iceCandidatePoolSize: 10
    });

    // Handle remote stream
    subscriberPc.ontrack = (event) => {
      console.log('🎥 Received remote stream for feed:', feedId);
      const remoteStream = event.streams[0];
      this.remoteStreams.set(feedId, remoteStream);

      this.events$.next({
        type: 'published',
        participant: { id: feedId, publisher: true },
        stream: remoteStream
      });
    };

    // Handle ICE candidates for subscriber
    subscriberPc.onicecandidate = (event) => {
      if (event.candidate) {
        this.consultationService.sendVideoMessage({
          type: 'trickle',
          data: {
            candidate: {
              candidate: event.candidate.candidate,
              sdpMid: event.candidate.sdpMid,
              sdpMLineIndex: event.candidate.sdpMLineIndex
            }
          }
        });
      } else {
        // End of candidates
        this.consultationService.sendVideoMessage({
          type: 'trickle',
          data: {
            candidate: null
          }
        });
      }
    };

    // Monitor ICE connection state for subscriber
    subscriberPc.oniceconnectionstatechange = () => {
      const state = subscriberPc.iceConnectionState;
      console.log(`🧊 Subscriber ${feedId} ICE connection state:`, state);
      
      if (state === 'failed' || state === 'disconnected') {
        console.warn(`⚠️ Subscriber ${feedId} ICE connection failed/disconnected`);
      } else if (state === 'connected' || state === 'completed') {
        console.log(`✅ Subscriber ${feedId} ICE connection established`);
      }
    };

    // Monitor general connection state for subscriber
    subscriberPc.onconnectionstatechange = () => {
      const state = subscriberPc.connectionState;
      console.log(`🔗 Subscriber ${feedId} connection state:`, state);
      
      if (state === 'failed') {
        console.error(`❌ Subscriber ${feedId} connection failed`);
      } else if (state === 'connected') {
        console.log(`✅ Subscriber ${feedId} connection established`);
      }
    };

    // Store the peer connection
    this.subscriberPcs.set(feedId, subscriberPc);

    // Send subscribe message to backend
    this.consultationService.sendVideoMessage({
      type: 'subscribe',
      data: {
        feed_id: feedId
      }
    });
  }

  async getParticipants(): Promise<void> {
    this.consultationService.sendVideoMessage({
      type: 'participants'
    });
  }

  async disconnect(): Promise<void> {
    await this.stopPublishing();

    // Close all subscriber peer connections
    for (const [feedId, pc] of this.subscriberPcs) {
      pc.close();
    }
    this.subscriberPcs.clear();

    this.remoteStreams.clear();
    this.participants$.next([]);
  }

  getLocalStream(): MediaStream | null {
    return this.localStream;
  }

  getRemoteStream(participantId: number): MediaStream | null {
    return this.remoteStreams.get(participantId) || null;
  }

  getAllRemoteStreams(): Map<number, MediaStream> {
    return new Map(this.remoteStreams);
  }

  async toggleVideo(): Promise<void> {
    if (this.localStream) {
      const videoTrack = this.localStream.getVideoTracks()[0];
      if (videoTrack) {
        videoTrack.enabled = !videoTrack.enabled;
        console.log('Video toggled:', videoTrack.enabled);
      }
    }
  }

  async toggleAudio(): Promise<void> {
    if (this.localStream) {
      const audioTrack = this.localStream.getAudioTracks()[0];
      if (audioTrack) {
        audioTrack.enabled = !audioTrack.enabled;
        console.log('Audio toggled:', audioTrack.enabled);
      }
    }
  }

  // Handle WebSocket messages from consultation service
  handleVideoMessage(data: any): void {
    console.log('📥 Received video message:', data);

    switch (data.type) {
      case 'room_created':
        console.log('✅ Room created with ID:', data.room_id);
        this.roomId = data.room_id;
        this.isRoomCreated = true;
        this.events$.next({ type: 'room_created', roomId: data.room_id });
        break;

      case 'janus_event':
        this.handleJanusEvent(data.payload);
        break;

      case 'participants':
        this.handleParticipants(data.data);
        break;

      default:
        console.log('Unhandled video message type:', data.type);
    }
  }

  private handleJanusEvent(event: any): void {
    console.log('🎬 Janus event:', event);

    // Handle hangup events
    if (event.janus === 'hangup') {
      console.log('📞 Janus hangup event:', event);
      this.handleHangup(event);
      return;
    }

    // Handle error events
    if (event.janus === 'error') {
      console.error('❌ Janus error event:', event);
      this.handleJanusError(event);
      return;
    }

    // Handle JSEP (SDP answers from Janus)
    if (event.jsep) {
      // For subscriber events, we need the feed ID from sender context
      const feedId = event.sender || event.feed_id;
      console.log('🔄 Handling JSEP for feed:', feedId, 'JSEP type:', event.jsep.type);
      this.handleJSEP(event.jsep, feedId);
    }

    // Handle videoroom events
    if (event.videoroom) {
      console.log('📹 VideoRoom event type:', event.videoroom);
      switch (event.videoroom) {
        case 'joined':
          console.log('✅ Successfully joined room');
          // After joining, get current participants
          this.getParticipants();
          break;
        case 'event':
          console.log('📡 VideoRoom event data:', event);
          if (event.publishers) {
            console.log('👥 New publishers detected:', event.publishers);
            this.handleNewPublishers(event.publishers);
          }
          if (event.unpublished) {
            console.log('📴 Publisher unpublished:', event.unpublished);
            this.handleUnpublished(event.unpublished);
          }
          break;
      }
    }
  }

  private async handleJSEP(jsep: any, feedId?: number): Promise<void> {
    console.log('🔄 Handling JSEP:', jsep, 'for feed:', feedId);

    if (jsep.type === 'answer') {
      // This is an answer to our offer (for publishing)
      if (this.publisherPc) {
        await this.publisherPc.setRemoteDescription(new RTCSessionDescription(jsep));
      }
    } else if (jsep.type === 'offer') {
      // This is an offer from Janus (for subscribing to a specific feed)
      if (feedId && this.subscriberPcs.has(feedId)) {
        const subscriberPc = this.subscriberPcs.get(feedId)!;
        await subscriberPc.setRemoteDescription(new RTCSessionDescription(jsep));
        const answer = await subscriberPc.createAnswer();
        await subscriberPc.setLocalDescription(answer);

        // Send answer back
        this.consultationService.sendVideoMessage({
          type: 'start',
          data: {
            jsep: {
              type: answer.type,
              sdp: answer.sdp
            }
          }
        });
      } else {
        console.error('No subscriber peer connection found for feed:', feedId);
      }
    }
  }

  private handleNewPublishers(publishers: any[]): void {
    console.log('📺 New publishers:', publishers);

    publishers.forEach(publisher => {
      // Subscribe to each new publisher
      this.subscribeToFeed(publisher.id);

      // Add to participants list
      const participant: VideoRoomParticipant = {
        id: publisher.id,
        display: publisher.display,
        publisher: true
      };

      const currentParticipants = this.participants$.value;
      if (!currentParticipants.find(p => p.id === publisher.id)) {
        this.participants$.next([...currentParticipants, participant]);
      }
    });
  }

  private handleUnpublished(unpublishedId: number): void {
    console.log('📴 Publisher unpublished:', unpublishedId);

    // Remove from participants
    const currentParticipants = this.participants$.value;
    this.participants$.next(currentParticipants.filter(p => p.id !== unpublishedId));

    // Remove remote stream
    this.remoteStreams.delete(unpublishedId);

    this.events$.next({
      type: 'unpublished',
      participant: { id: unpublishedId, publisher: false }
    });
  }

  private handleParticipants(participants: any[]): void {
    console.log('👥 Participants list:', participants);

    const participantList: VideoRoomParticipant[] = participants.map(p => ({
      id: p.id,
      display: p.display,
      publisher: p.publisher || false,
      talking: p.talking || false
    }));

    this.participants$.next(participantList);
  }

  private handleHangup(event: any): void {
    console.log('📞 Handling hangup event:', event);
    
    // Check if this is a publisher or subscriber hangup
    const reason = event.reason || 'Unknown reason';
    console.log(`📞 Connection hangup: ${reason}`);

    // If publisher connection was hung up, clean up local publishing
    if (this.publisherPc && this.publisherPc.connectionState === 'failed') {
      console.log('📞 Publisher connection failed, cleaning up...');
      this.stopPublishing();
    }

    // Check for failed subscriber connections
    for (const [feedId, pc] of this.subscriberPcs) {
      if (pc.connectionState === 'failed') {
        console.log(`📞 Subscriber connection failed for feed ${feedId}, cleaning up...`);
        pc.close();
        this.subscriberPcs.delete(feedId);
        this.remoteStreams.delete(feedId);
        
        // Remove from participants list
        const currentParticipants = this.participants$.value;
        this.participants$.next(currentParticipants.filter(p => p.id !== feedId));
        
        // Emit unpublished event
        this.events$.next({
          type: 'unpublished',
          participant: { id: feedId, publisher: false }
        });
      }
    }

    // Attempt to rejoin if needed (after ICE failures)
    if (reason.includes('ICE') || reason.includes('connection')) {
      console.log('📞 ICE connection failed, may need to rejoin...');
      // You could implement reconnection logic here if needed
    }
  }

  private handleJanusError(event: any): void {
    console.error('❌ Handling Janus error:', event);
    
    const errorCode = event.error?.code || 'unknown';
    const errorReason = event.error?.reason || event.reason || 'Unknown error';
    
    console.error(`❌ Janus error ${errorCode}: ${errorReason}`);

    // Handle specific error codes if needed
    switch (errorCode) {
      case 405: // Room doesn't exist
        console.error('❌ Room does not exist, may need to recreate');
        break;
      case 426: // No such feed
        console.error('❌ Feed does not exist');
        break;
      default:
        console.error('❌ Unhandled Janus error:', errorCode, errorReason);
    }

    // Emit error event for UI handling
    this.events$.next({
      type: 'unpublished', // Use existing event type for now
      participant: { id: -1, publisher: false }
    });
  }
}
