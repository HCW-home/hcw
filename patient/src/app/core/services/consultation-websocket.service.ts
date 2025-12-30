import { Injectable, OnDestroy } from '@angular/core';
import { BehaviorSubject, Observable, Subject } from 'rxjs';
import { environment } from '../../../environments/environment';
import { StorageService } from './storage.service';
import {
  WebSocketState,
  ConsultationMessageEvent,
  MessageEvent as WsMessageEvent,
  ParticipantJoinedEvent,
  ParticipantLeftEvent,
  AppointmentUpdatedEvent,
  ConsultationIncomingEvent,
} from '../models/websocket.model';

interface ConsultationParticipant {
  id: number;
  username: string;
  is_online: boolean;
}

@Injectable({
  providedIn: 'root'
})
export class ConsultationWebSocketService implements OnDestroy {
  private socket: WebSocket | null = null;
  private consultationId: number | null = null;
  private reconnectAttempts = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private maxReconnectAttempts = 10;
  private reconnectInterval = 3000;

  private stateSubject = new BehaviorSubject<WebSocketState>(WebSocketState.DISCONNECTED);
  public state$ = this.stateSubject.asObservable();

  private messagesSubject = new Subject<ConsultationMessageEvent>();
  public messages$ = this.messagesSubject.asObservable();

  private messageUpdatedSubject = new Subject<WsMessageEvent>();
  public messageUpdated$ = this.messageUpdatedSubject.asObservable();

  private participantsSubject = new BehaviorSubject<ConsultationParticipant[]>([]);
  public participants$ = this.participantsSubject.asObservable();

  private participantJoinedSubject = new Subject<ParticipantJoinedEvent>();
  public participantJoined$ = this.participantJoinedSubject.asObservable();

  private participantLeftSubject = new Subject<ParticipantLeftEvent>();
  public participantLeft$ = this.participantLeftSubject.asObservable();

  private appointmentUpdatedSubject = new Subject<AppointmentUpdatedEvent>();
  public appointmentUpdated$ = this.appointmentUpdatedSubject.asObservable();

  private allEventsSubject = new Subject<ConsultationIncomingEvent>();
  public allEvents$ = this.allEventsSubject.asObservable();

  constructor(private storage: StorageService) {}

  async connect(consultationId: number): Promise<void> {
    if (this.socket && this.socket.readyState === WebSocket.OPEN && this.consultationId === consultationId) {
      return;
    }

    if (this.socket) {
      this.disconnect();
    }

    const token = await this.storage.get('access_token');
    if (!token) {
      this.stateSubject.next(WebSocketState.FAILED);
      return;
    }

    this.consultationId = consultationId;
    this.stateSubject.next(WebSocketState.CONNECTING);

    const wsBase = environment.apiUrl.replace(/^http/, 'ws').replace('/api', '');
    const url = `${wsBase}/ws/user/?token=${token}`;

    try {
      this.socket = new WebSocket(url);
      this.setupEventHandlers();
    } catch (error) {
      this.stateSubject.next(WebSocketState.FAILED);
      this.attemptReconnect();
    }
  }

  disconnect(): void {
    this.clearReconnectTimer();
    this.reconnectAttempts = 0;

    if (this.socket && this.socket.readyState === WebSocket.OPEN && this.consultationId) {
      this.send({
        type: 'leave_group',
        data: {
          group_name: `consultation_${this.consultationId}`
        }
      });
    }

    if (this.socket) {
      this.socket.close(1000, 'Client disconnect');
      this.socket = null;
    }

    this.consultationId = null;
    this.stateSubject.next(WebSocketState.DISCONNECTED);
    this.participantsSubject.next([]);
  }

  sendMessage(message: string): void {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      return;
    }

    this.send({
      type: 'send_message',
      data: { message },
      timestamp: Date.now(),
    });
  }

  send(message: unknown): void {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      return;
    }

    try {
      this.socket.send(JSON.stringify(message));
    } catch (error) {
      // Silent fail
    }
  }

  getParticipants(): void {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      return;
    }

    this.send({ type: 'participants' });
  }

  private setupEventHandlers(): void {
    if (!this.socket) return;

    this.socket.onopen = () => {
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

    this.socket.onmessage = (event: MessageEvent) => {
      try {
        const message = JSON.parse(event.data) as ConsultationIncomingEvent;
        this.handleMessage(message);
      } catch (error) {
        // Silent fail
      }
    };

    this.socket.onerror = () => {
      this.stateSubject.next(WebSocketState.FAILED);
    };

    this.socket.onclose = (event: CloseEvent) => {
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

    if ('event' in message && (message as { event: string }).event === 'consultation') {
      return;
    }

    switch (message.type) {
      case 'participants':
        this.participantsSubject.next((message as { type: string; data: ConsultationParticipant[] }).data);
        break;

      case 'consultation_message':
        this.messagesSubject.next(message as ConsultationMessageEvent);
        break;

      case 'message':
        this.messageUpdatedSubject.next(message as WsMessageEvent);
        break;

      case 'participant_joined':
        this.participantJoinedSubject.next(message as ParticipantJoinedEvent);
        break;

      case 'participant_left':
        this.participantLeftSubject.next(message as ParticipantLeftEvent);
        break;

      case 'appointment_updated':
        this.appointmentUpdatedSubject.next(message as AppointmentUpdatedEvent);
        break;

      case 'group_joined':
      case 'group_left':
        break;

      case 'error':
        break;
    }
  }

  private attemptReconnect(): void {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      this.stateSubject.next(WebSocketState.FAILED);
      return;
    }

    if (!this.consultationId) {
      return;
    }

    this.reconnectAttempts++;

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

  get isConnected(): boolean {
    return this.stateSubject.value === WebSocketState.CONNECTED;
  }

  get currentConsultationId(): number | null {
    return this.consultationId;
  }

  ngOnDestroy(): void {
    this.disconnect();
  }
}
