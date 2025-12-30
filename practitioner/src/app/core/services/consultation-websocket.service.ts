import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable, Subject } from 'rxjs';
import { environment } from '../../../environments/environment';
import {
  WebSocketState,
  ConsultationIncomingEvent,
  ConsultationMessageEvent,
  MessageEvent as WsMessageEvent,
  ParticipantJoinedEvent,
  ParticipantLeftEvent,
  AppointmentUpdatedEvent,
  ConsultationParticipant,
} from '../models/websocket';
import { Auth } from './auth';

@Injectable({
  providedIn: 'root',
})
export class ConsultationWebSocketService {
  private ws: WebSocket | null = null;
  private consultationId: number | null = null;

  private stateSubject = new BehaviorSubject<WebSocketState>(WebSocketState.DISCONNECTED);
  private messagesSubject = new Subject<ConsultationMessageEvent>();
  private messageUpdatedSubject = new Subject<WsMessageEvent>();
  private participantsSubject = new BehaviorSubject<ConsultationParticipant[]>([]);
  private participantJoinedSubject = new Subject<ParticipantJoinedEvent>();
  private participantLeftSubject = new Subject<ParticipantLeftEvent>();
  private appointmentUpdatedSubject = new Subject<AppointmentUpdatedEvent>();
  private allEventsSubject = new Subject<ConsultationIncomingEvent>();

  public state$: Observable<WebSocketState> = this.stateSubject.asObservable();
  public messages$: Observable<ConsultationMessageEvent> = this.messagesSubject.asObservable();
  public messageUpdated$: Observable<WsMessageEvent> = this.messageUpdatedSubject.asObservable();
  public participants$: Observable<ConsultationParticipant[]> = this.participantsSubject.asObservable();
  public participantJoined$: Observable<ParticipantJoinedEvent> = this.participantJoinedSubject.asObservable();
  public participantLeft$: Observable<ParticipantLeftEvent> = this.participantLeftSubject.asObservable();
  public appointmentUpdated$: Observable<AppointmentUpdatedEvent> = this.appointmentUpdatedSubject.asObservable();
  public allEvents$: Observable<ConsultationIncomingEvent> = this.allEventsSubject.asObservable();

  private reconnectAttempts = 0;
  private maxReconnectAttempts = 10;
  private reconnectInterval = 3000;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(private authService: Auth) {}

  connect(consultationId: number): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN && this.consultationId === consultationId) {
      console.warn('Already connected to this consultation');
      return;
    }

    if (this.ws) {
      this.disconnect();
    }

    const token = this.authService.getToken();
    if (!token) {
      console.error('Cannot connect: No authentication token');
      return;
    }

    this.consultationId = consultationId;
    this.stateSubject.next(WebSocketState.CONNECTING);

    const wsUrl = `${environment.wsUrl}/user/?token=${token}`;

    try {
      this.ws = new WebSocket(wsUrl);
      this.setupEventHandlers();
    } catch (error) {
      console.error('WebSocket connection error:', error);
      this.stateSubject.next(WebSocketState.FAILED);
      this.attemptReconnect();
    }
  }

  disconnect(): void {
    this.clearReconnectTimer();
    this.reconnectAttempts = 0;

    if (this.ws && this.ws.readyState === WebSocket.OPEN && this.consultationId) {
      this.send({
        type: 'leave_group',
        data: {
          group_name: `consultation_${this.consultationId}`
        }
      });
    }

    if (this.ws) {
      this.ws.close(1000, 'Client disconnect');
      this.ws = null;
    }

    this.consultationId = null;
    this.stateSubject.next(WebSocketState.DISCONNECTED);
    this.participantsSubject.next([]);
  }

  sendMessage(message: string): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      console.warn('WebSocket not connected, cannot send message');
      return;
    }

    try {
      this.ws.send(JSON.stringify({
        type: 'send_message',
        data: { message },
        timestamp: Date.now(),
      }));
    } catch (error) {
      console.error('Error sending message:', error);
    }
  }

  send(message: unknown): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      console.warn('WebSocket not connected');
      return;
    }

    try {
      this.ws.send(JSON.stringify(message));
    } catch (error) {
      console.error('Error sending WebSocket message:', error);
    }
  }

  getParticipants(): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      console.warn('WebSocket not connected');
      return;
    }

    try {
      this.ws.send(JSON.stringify({
        type: 'participants',
      }));
    } catch (error) {
      console.error('Error requesting participants:', error);
    }
  }

  isConnected(): boolean {
    return this.stateSubject.value === WebSocketState.CONNECTED;
  }

  private setupEventHandlers(): void {
    if (!this.ws) return;

    this.ws.onopen = () => {
      console.log('Consultation WebSocket connected');
      this.stateSubject.next(WebSocketState.CONNECTED);
      this.reconnectAttempts = 0;

      if (this.consultationId) {
        this.send({
          type: 'join_group',
          data: {
            group_name: `consultation_${this.consultationId}`
          }
        });
      }
    };

    this.ws.onmessage = (event: MessageEvent) => {
      try {
        const message: ConsultationIncomingEvent = JSON.parse(event.data) as ConsultationIncomingEvent;
        this.handleMessage(message);
      } catch (error) {
        console.error('Error parsing WebSocket message:', error);
      }
    };

    this.ws.onerror = (error: Event) => {
      console.error('WebSocket error:', error);
      this.stateSubject.next(WebSocketState.FAILED);
    };

    this.ws.onclose = (event: CloseEvent) => {
      console.log('WebSocket closed:', event.code, event.reason);

      if (event.code !== 1000) {
        this.stateSubject.next(WebSocketState.RECONNECTING);
        this.attemptReconnect();
      } else {
        this.stateSubject.next(WebSocketState.DISCONNECTED);
      }
    };
  }

  private handleMessage(message: ConsultationIncomingEvent): void {
    this.allEventsSubject.next(message);

    if ('event' in message && message.event === 'consultation') {
      console.log('Consultation event received:', message);
      return;
    }

    switch (message.type) {
      case 'participants':
        this.participantsSubject.next(message.data);
        break;

      case 'consultation_message':
        this.messagesSubject.next(message);
        break;

      case 'message':
        this.messageUpdatedSubject.next(message as WsMessageEvent);
        break;

      case 'participant_joined':
        this.participantJoinedSubject.next(message);
        break;

      case 'participant_left':
        this.participantLeftSubject.next(message);
        break;

      case 'appointment_updated':
        this.appointmentUpdatedSubject.next(message);
        break;

      case 'group_joined':
      case 'group_left':
        console.log('Group operation:', message.type, message.data);
        break;

      case 'error':
        console.error('WebSocket error message:', message.message);
        break;

      default:
        console.log('Unhandled message type:', message);
    }
  }

  private attemptReconnect(): void {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.error('Max reconnection attempts reached');
      this.stateSubject.next(WebSocketState.FAILED);
      return;
    }

    if (!this.consultationId) {
      console.error('Cannot reconnect: No consultation ID');
      return;
    }

    this.reconnectAttempts++;
    console.log(
      `Reconnecting in ${this.reconnectInterval}ms (attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts})`
    );

    this.reconnectTimer = setTimeout(() => {
      if (this.consultationId) {
        this.connect(this.consultationId);
      }
    }, this.reconnectInterval);
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }
}
