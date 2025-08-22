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
  private subscriberHandleToFeedMap: Map<number, number> = new Map(); // Maps subscriber handle ID to feed ID

  private participants$ = new BehaviorSubject<VideoRoomParticipant[]>([]);
  private events$ = new Subject<VideoRoomEvent>();

  // Public observables
  public readonly participants = this.participants$.asObservable();
  public readonly events = this.events$.asObservable();

  private roomId: number | null = null;
  private isRoomCreated = false;
  private iceServers: RTCIceServer[] = [
    { urls: 'stun:stun.l.google.com:19302' }
  ];

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

      // Get user media with specific constraints to avoid issues
      const constraints = {
        video: video ? {
          width: { ideal: 640, max: 1280 },
          height: { ideal: 480, max: 720 },
          frameRate: { ideal: 15, max: 30 }
        } : false,
        audio: audio ? {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        } : false
      };
      
      console.log('🎥 Requesting media with constraints:', constraints);
      this.localStream = await navigator.mediaDevices.getUserMedia(constraints);
      console.log('🎥 Got local media stream:', this.localStream.getTracks().map(t => `${t.kind}:${t.label}`));

      // Create RTCPeerConnection for publishing
      this.publisherPc = new RTCPeerConnection({
        iceServers: this.iceServers,
        iceCandidatePoolSize: 10,
        iceTransportPolicy: 'all',  // Allow all connection types
        bundlePolicy: 'max-bundle',
        rtcpMuxPolicy: 'require'
      });
      
      console.log('🔧 Publisher PeerConnection created with ICE servers:', this.iceServers);

      // Add local stream to peer connection
      this.localStream.getTracks().forEach(track => {
        this.publisherPc!.addTrack(track, this.localStream!);
      });

      // Handle ICE candidates
      this.publisherPc.onicecandidate = (event) => {
        if (event.candidate) {
          console.log('🧊 Publisher ICE candidate type:', event.candidate.type, 'protocol:', event.candidate.protocol);
          console.log('🧊 Publisher ICE candidate:', event.candidate.candidate);
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
          console.log('🧊 Publisher ICE candidate gathering complete');
          // End of candidates
          this.consultationService.sendVideoMessage({
            type: 'trickle',
            data: {
              candidate: null
            }
          });
        }
      };
      
      // Add ICE gathering state monitoring
      this.publisherPc.onicegatheringstatechange = () => {
        console.log('🧊 Publisher ICE gathering state:', this.publisherPc?.iceGatheringState);
      };

      // Monitor ICE connection state
      this.publisherPc.oniceconnectionstatechange = () => {
        const state = this.publisherPc?.iceConnectionState;
        console.log('🧊 Publisher ICE connection state:', state);
        
        if (state === 'failed') {
          console.error('❌ Publisher ICE connection failed - will restart ICE');
          this.handleIceFailure('publisher');
        } else if (state === 'disconnected') {
          console.warn('⚠️ Publisher ICE connection disconnected - monitoring for recovery');
          // Set a timeout to detect if we recover or need to restart
          setTimeout(() => {
            if (this.publisherPc?.iceConnectionState === 'disconnected') {
              console.warn('⚠️ Publisher ICE still disconnected after 5s, restarting ICE');
              this.handleIceFailure('publisher');
            }
          }, 5000);
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

    // Check if we already have a PC for this feed
    if (this.subscriberPcs.has(feedId)) {
      console.log('⚠️ Already subscribed to feed:', feedId);
      return;
    }

    // Create a new peer connection for this subscriber
    const subscriberPc = new RTCPeerConnection({
      iceServers: this.iceServers,
      iceCandidatePoolSize: 10,
      iceTransportPolicy: 'all',  // Allow all connection types
      bundlePolicy: 'max-bundle',
      rtcpMuxPolicy: 'require'
    });
    
    console.log(`🔧 Subscriber PeerConnection created for feed ${feedId} with ICE servers:`, this.iceServers);

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
        console.log(`🧊 Subscriber ${feedId} ICE candidate:`, event.candidate.candidate);
        this.consultationService.sendVideoMessage({
          type: 'trickle',
          data: {
            feed_id: feedId,  // Include feed_id so backend knows which handle to use
            candidate: {
              candidate: event.candidate.candidate,
              sdpMid: event.candidate.sdpMid,
              sdpMLineIndex: event.candidate.sdpMLineIndex
            }
          }
        });
      } else {
        console.log(`🧊 Subscriber ${feedId} ICE candidate gathering complete`);
        // End of candidates
        this.consultationService.sendVideoMessage({
          type: 'trickle',
          data: {
            feed_id: feedId,  // Include feed_id so backend knows which handle to use
            candidate: null
          }
        });
      }
    };

    // Monitor ICE connection state for subscriber
    subscriberPc.oniceconnectionstatechange = () => {
      const state = subscriberPc.iceConnectionState;
      console.log(`🧊 Subscriber ${feedId} ICE connection state:`, state);
      
      if (state === 'failed') {
        console.error(`❌ Subscriber ${feedId} ICE connection failed - will restart ICE`);
        this.handleIceFailure('subscriber', feedId);
      } else if (state === 'disconnected') {
        console.warn(`⚠️ Subscriber ${feedId} ICE connection disconnected - monitoring for recovery`);
        // Set a timeout to detect if we recover or need to restart
        setTimeout(() => {
          if (subscriberPc.iceConnectionState === 'disconnected') {
            console.warn(`⚠️ Subscriber ${feedId} ICE still disconnected after 5s, restarting ICE`);
            this.handleIceFailure('subscriber', feedId);
          }
        }, 5000);
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
    
    console.log(`📺 Sent subscribe request for feed ${feedId}`);
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
      case 'ice_config':
        console.log('🧊 Received ICE configuration from backend:', data.data);
        if (data.data && data.data.iceServers) {
          // Update ICE servers configuration with the backend-provided config
          this.iceServers = data.data.iceServers;
          console.log('✅ Updated ICE servers configuration:', this.iceServers);
          
          // If we have existing peer connections, update their configuration won't work,
          // but future connections will use the new config
          if (this.publisherPc || this.subscriberPcs.size > 0) {
            console.log('ℹ️ ICE servers updated - will apply to new connections');
          }
        }
        break;

      case 'room_created':
        console.log('✅ Room created with ID:', data.room_id);
        this.roomId = data.room_id;
        this.isRoomCreated = true;
        this.events$.next({ type: 'room_created', roomId: data.room_id });
        break;

      case 'joined':
        console.log('✅ Joined room as publisher with ID:', data.publisher_id);
        break;

      case 'janus_event':
        this.handleJanusEvent(data.payload);
        break;

      case 'participants':
        this.handleParticipants(data.data);
        break;

      case 'error':
        console.error('❌ Error from backend:', data.message);
        break;

      default:
        console.log('Unhandled video message type:', data.type);
    }
  }

  private handleJanusEvent(event: any): void {
    console.log('🎬 Janus event:', event);
    
    // Log JSEP events specifically for debugging
    if (event.jsep) {
      console.log('🔔 JSEP detected in event:', event.jsep.type, 'SDP length:', event.jsep.sdp?.length || 0);
    }

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
      // For publisher events, feedId will be undefined (which is expected)
      let feedId = event.sender || event.feed_id;
      console.log('🔄 Handling JSEP for handle/feed:', feedId, 'JSEP type:', event.jsep.type);
      
      // Determine if this is a publisher or subscriber JSEP based on type and context
      if (event.jsep.type === 'answer' && !feedId) {
        console.log('📤 This appears to be a publisher JSEP answer');
      } else if (event.jsep.type === 'offer') {
        console.log('📥 This appears to be a subscriber JSEP offer');
        
        // For subscriber offers, check if we have the actual feed ID from the event
        if (event.plugindata?.data?.id) {
          const actualFeedId = event.plugindata.data.id;
          console.log('📌 Mapping subscriber handle', feedId, 'to feed ID', actualFeedId);
          this.subscriberHandleToFeedMap.set(feedId, actualFeedId);
          feedId = actualFeedId; // Use the actual feed ID for PC lookup
        }
      }
      
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

    try {
      if (jsep.type === 'answer') {
        // This is an answer to our offer (for publishing)
        // Publisher answers don't have a feedId since they come from the main handle
        console.log('📤 Received JSEP answer for publisher');
        if (this.publisherPc) {
          console.log('🔄 Setting remote description on publisher peer connection');
          await this.publisherPc.setRemoteDescription(new RTCSessionDescription(jsep));
          console.log('✅ Publisher remote description set successfully');
          
          // Check ICE connection state after setting remote description
          console.log('🧊 Publisher ICE connection state:', this.publisherPc.iceConnectionState);
          console.log('🧊 Publisher connection state:', this.publisherPc.connectionState);
        } else {
          console.error('❌ No publisher peer connection available for JSEP answer');
        }
      } else if (jsep.type === 'offer') {
        // This is an offer from Janus (for subscribing to a specific feed)
        console.log('📥 Received offer for subscriber feed:', feedId);
        if (feedId && this.subscriberPcs.has(feedId)) {
          const subscriberPc = this.subscriberPcs.get(feedId)!;
          
          console.log('🔄 Setting remote description for subscriber');
          await subscriberPc.setRemoteDescription(new RTCSessionDescription(jsep));
          
          console.log('🔄 Creating answer for subscriber');
          const answer = await subscriberPc.createAnswer();
          await subscriberPc.setLocalDescription(answer);

          console.log('📤 Sending answer back to Janus for feed:', feedId);
          // Send answer back
          this.consultationService.sendVideoMessage({
            type: 'start',
            data: {
              feed_id: feedId,  // Include feed_id so backend knows which subscriber handle to use
              jsep: {
                type: answer.type,
                sdp: answer.sdp
              }
            }
          });
        } else {
          console.error('❌ No subscriber peer connection found for feed:', feedId);
          // The subscriber PC should have been created when we called subscribeToFeed
          // This might indicate an issue with the subscription flow
          console.log('🔍 Available subscriber PCs:', Array.from(this.subscriberPcs.keys()));
        }
      }
    } catch (error) {
      console.error('❌ Error handling JSEP:', error);
      // Don't throw the error to prevent breaking the event loop
    }
  }

  private handleNewPublishers(publishers: any[]): void {
    console.log('📺 New publishers:', publishers);

    publishers.forEach(publisher => {
      console.log(`📺 Processing new publisher: ${publisher.display} (ID: ${publisher.id})`);
      
      // Subscribe to each new publisher
      this.subscribeToFeed(publisher.id);

      // Add to participants list
      const participant: VideoRoomParticipant = {
        id: publisher.id,
        display: publisher.display || `User ${publisher.id}`,
        publisher: true
      };

      const currentParticipants = this.participants$.value;
      const existingParticipant = currentParticipants.find(p => p.id === publisher.id);
      
      if (!existingParticipant) {
        console.log(`➕ Adding new participant: ${participant.display}`);
        this.participants$.next([...currentParticipants, participant]);
      } else {
        console.log(`🔄 Participant ${participant.display} already exists, updating status`);
        // Update existing participant to ensure they're marked as publisher
        existingParticipant.publisher = true;
        this.participants$.next([...currentParticipants]);
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
    console.log('👥 Participants list received:', participants);

    const participantList: VideoRoomParticipant[] = participants.map(p => ({
      id: p.id,
      display: p.display || `User ${p.id}`,
      publisher: p.publisher || false,
      talking: p.talking || false
    }));

    console.log('👥 Processed participant list:', participantList);
    this.participants$.next(participantList);

    // For each publisher in the list, make sure we're subscribed to their feed
    participants.forEach(participant => {
      if (participant.publisher && !this.subscriberPcs.has(participant.id)) {
        console.log(`🔗 Auto-subscribing to existing publisher: ${participant.display} (ID: ${participant.id})`);
        this.subscribeToFeed(participant.id);
      }
    });
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

  private async handleIceFailure(type: 'publisher' | 'subscriber', feedId?: number): Promise<void> {
    console.log(`🔄 Handling ICE failure for ${type}${feedId ? ` (feed ${feedId})` : ''}`);
    
    try {
      if (type === 'publisher' && this.publisherPc) {
        // Restart ICE for publisher by creating a new offer with iceRestart
        console.log('🔄 Restarting ICE for publisher...');
        
        const offer = await this.publisherPc.createOffer({ iceRestart: true });
        await this.publisherPc.setLocalDescription(offer);
        
        // Send the new offer to restart ICE
        this.consultationService.sendVideoMessage({
          type: 'publish',
          data: {
            jsep: {
              type: offer.type,
              sdp: offer.sdp
            }
          }
        });
        
      } else if (type === 'subscriber' && feedId && this.subscriberPcs.has(feedId)) {
        // For subscribers, we need to resubscribe to the feed
        console.log(`🔄 Resubscribing to feed ${feedId}...`);
        
        // Close the old peer connection
        const oldPc = this.subscriberPcs.get(feedId);
        if (oldPc) {
          oldPc.close();
          this.subscriberPcs.delete(feedId);
        }
        
        // Remove the old stream
        this.remoteStreams.delete(feedId);
        
        // Resubscribe after a short delay
        setTimeout(() => {
          this.subscribeToFeed(feedId);
        }, 1000);
      }
    } catch (error) {
      console.error(`❌ Error handling ICE failure for ${type}:`, error);
    }
  }
}
