export enum WebSocketState {
  CONNECTING = 'CONNECTING',
  CONNECTED = 'CONNECTED',
  DISCONNECTED = 'DISCONNECTED',
  RECONNECTING = 'RECONNECTING',
  FAILED = 'FAILED',
}

export interface WebSocketMessage<T = unknown> {
  type: string;
  data?: T;
  timestamp?: number;
}

export interface PingMessage {
  type: 'ping';
  timestamp: number;
}

export interface GetStatusMessage {
  type: 'get_status';
}

export interface SendMessageData {
  target_user_id: number;
  message: string;
  message_type?: string;
}

export interface SendMessageMessage {
  type: 'send_message';
  data: SendMessageData;
  timestamp: number;
}

export interface JoinGroupMessage {
  type: 'join_group';
  data: {
    group_name: string;
  };
}

export interface LeaveGroupMessage {
  type: 'leave_group';
  data: {
    group_name: string;
  };
}

export type UserOutgoingMessage =
  | PingMessage
  | GetStatusMessage
  | SendMessageMessage
  | JoinGroupMessage
  | LeaveGroupMessage;

export interface StatusChangedEvent {
  type: 'status_changed';
  data: {
    user_id: number;
    is_online: boolean;
    connection_count: number;
    connection_id: string;
  };
}

export interface StatusResponseEvent {
  type: 'status_response';
  data: {
    user_id: number;
    is_online: boolean;
    connection_count: number;
    connection_id: string;
  };
}

export interface PongEvent {
  type: 'pong';
  timestamp: number;
}

export interface UserMessageEvent {
  type: 'user_message';
  data: {
    message_type: string;
    from_user_id: number;
    from_username: string;
    message: string;
    timestamp: number;
  };
}

export interface NotificationEvent {
  type: 'notification';
  data: Record<string, unknown>;
}

export interface SystemBroadcastEvent {
  type: 'system_broadcast';
  data: {
    message_type: string;
    from_user_id: number;
    message: string;
    timestamp: number;
  };
}

export interface GroupJoinedEvent {
  type: 'group_joined';
  data: {
    group_name: string;
  };
}

export interface GroupLeftEvent {
  type: 'group_left';
  data: {
    group_name: string;
  };
}

export interface ErrorEvent {
  type: 'error';
  message: string;
}

export type UserIncomingEvent =
  | StatusChangedEvent
  | StatusResponseEvent
  | PongEvent
  | UserMessageEvent
  | NotificationEvent
  | SystemBroadcastEvent
  | GroupJoinedEvent
  | GroupLeftEvent
  | ErrorEvent;

export interface ConsultationMessageEvent {
  type: 'consultation_message';
  data: {
    id: number;
    consultation_id: number;
    user_id: number;
    username: string;
    message: string;
    timestamp: string;
  };
}

export interface ParticipantJoinedEvent {
  type: 'participant_joined';
  data: {
    participant_id: number;
    username: string;
    timestamp: string;
  };
}

export interface ParticipantLeftEvent {
  type: 'participant_left';
  data: {
    participant_id: number;
    username: string;
    timestamp: string;
  };
}

export interface AppointmentUpdatedEvent {
  type: 'appointment_updated';
  data: {
    appointment_id: number;
    status: string;
    timestamp: string;
  };
}

export type ConsultationIncomingEvent =
  | ConsultationMessageEvent
  | ParticipantJoinedEvent
  | ParticipantLeftEvent
  | AppointmentUpdatedEvent
  | GroupJoinedEvent
  | GroupLeftEvent
  | ErrorEvent;

export interface WebSocketConfig {
  url: string;
  reconnect?: boolean;
  reconnectInterval?: number;
  reconnectAttempts?: number;
  pingInterval?: number;
}
