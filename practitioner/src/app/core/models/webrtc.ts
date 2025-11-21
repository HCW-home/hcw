export interface JanusJsep {
  type: 'offer' | 'answer';
  sdp: string;
}

export interface JanusParticipant {
  id: number;
  display: string;
  publisher?: boolean;
  audio_codec?: string;
  video_codec?: string;
  talking?: boolean;
}

export interface CreateRoomMessage {
  type: 'create_room';
}

export interface JoinRoomMessage {
  type: 'join';
  data: {
    display_name: string;
  };
}

export interface PublishMessage {
  type: 'publish';
  data: {
    jsep: JanusJsep;
  };
}

export interface SubscribeMessage {
  type: 'subscribe';
  data: {
    feed_id: number;
  };
}

export interface StartMessage {
  type: 'start';
  data: {
    jsep: JanusJsep;
    feed_id?: number;
  };
}

export interface TrickleMessage {
  type: 'trickle';
  data: {
    candidate: RTCIceCandidateInit | null;
    feed_id?: number;
  };
}

export interface GetParticipantsMessage {
  type: 'participants';
}

export type WebRTCOutgoingMessage =
  | CreateRoomMessage
  | JoinRoomMessage
  | PublishMessage
  | SubscribeMessage
  | StartMessage
  | TrickleMessage
  | GetParticipantsMessage;

export interface IceConfigData {
  iceServers: RTCIceServer[];
  iceCandidatePoolSize: number;
  bundlePolicy: string;
  rtcpMuxPolicy: string;
  iceTransportPolicy: string;
}

export interface RoomCreatedData {
  type: 'room_created';
  room_id: number;
}

export interface JoinedData {
  type: 'joined';
  publisher_id: number;
}

export interface JanusEventData {
  type: 'janus_event';
  payload: {
    janus?: string;
    jsep?: JanusJsep;
    feed_id?: number;
    plugindata?: {
      data?: {
        videoroom?: string;
        publishers?: JanusParticipant[];
        unpublished?: number;
        leaving?: number;
      };
    };
  };
}

export interface ParticipantsData {
  type: 'participants';
  data: JanusParticipant[];
}

export type WebRTCIncomingEvent =
  | RoomCreatedData
  | JoinedData
  | JanusEventData
  | ParticipantsData;

export interface LocalStream {
  stream: MediaStream;
  audioEnabled: boolean;
  videoEnabled: boolean;
}

export interface RemoteStream {
  feedId: number;
  stream: MediaStream;
  participant: JanusParticipant;
  peerConnection: RTCPeerConnection;
}

export interface WebRTCConfig {
  iceServers?: RTCIceServer[];
  audio?: boolean;
  video?: boolean | MediaTrackConstraints;
}
