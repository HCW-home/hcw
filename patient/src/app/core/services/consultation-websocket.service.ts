import { Injectable, OnDestroy } from '@angular/core';
import { BehaviorSubject, Observable, Subject, Subscription } from 'rxjs';
import { filter } from 'rxjs/operators';
import { environment } from '../../../environments/environment';
import { StorageService } from './storage.service';
import {
  WebSocketState,
  ConsultationMessageEvent,
  ParticipantJoinedEvent,
  ParticipantLeftEvent,
  AppointmentUpdatedEvent,
} from '../models/websocket.model';

@Injectable({
  providedIn: 'root'
})
export class ConsultationWebSocketService implements OnDestroy {
  private socket: WebSocket | null = null;
  private consultationId: number | null = null;
  private reconnectAttempts = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private maxReconnectAttempts = 5;
  private reconnectInterval = 3000;

  private stateSubject = new BehaviorSubject<WebSocketState>(WebSocketState.DISCONNECTED);
  public state$ = this.stateSubject.asObservable();

  private messagesSubject = new Subject<ConsultationMessageEvent['data']>();
  public messages$ = this.messagesSubject.asObservable();

  private participantJoinedSubject = new Subject<ParticipantJoinedEvent['data']>();
  public participantJoined$ = this.participantJoinedSubject.asObservable();

  private participantLeftSubject = new Subject<ParticipantLeftEvent['data']>();
  public participantLeft$ = this.participantLeftSubject.asObservable();

  private appointmentUpdatedSubject = new Subject<AppointmentUpdatedEvent['data']>();
  public appointmentUpdated$ = this.appointmentUpdatedSubject.asObservable();

  constructor(private storage: StorageService) {}

  async connect(consultationId: number): Promise<void> {
    if (this.socket && this.socket.readyState === WebSocket.OPEN) {
      if (this.consultationId === consultationId) {
        return;
      }
      this.disconnect();
    }

    const token = await this.storage.get('access_token');
    if (!token) {
      this.stateSubject.next(WebSocketState.FAILED);
      return;
    }

    this.consultationId = consultationId;
    const wsBase = environment.apiUrl.replace(/^http/, 'ws').replace('/api', '');
    const url = `${wsBase}/ws/consultation/${consultationId}/?token=${token}`;

    this.stateSubject.next(WebSocketState.CONNECTING);
    this.createConnection(url);
  }

  private createConnection(url: string): void {
    try {
      this.socket = new WebSocket(url);
      this.setupEventHandlers();
    } catch (error) {
      this.handleConnectionError();
    }
  }

  private setupEventHandlers(): void {
    if (!this.socket) return;

    this.socket.onopen = () => {
      this.stateSubject.next(WebSocketState.CONNECTED);
      this.reconnectAttempts = 0;
    };

    this.socket.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data);
        this.handleMessage(message);
      } catch (error) {
        // Silent fail
      }
    };

    this.socket.onclose = () => {
      this.stateSubject.next(WebSocketState.DISCONNECTED);
      this.attemptReconnect();
    };

    this.socket.onerror = () => {
      this.handleConnectionError();
    };
  }

  private handleMessage(message: { type: string; data?: unknown }): void {
    switch (message.type) {
      case 'consultation_message':
        this.messagesSubject.next((message as ConsultationMessageEvent).data);
        break;
      case 'participant_joined':
        this.participantJoinedSubject.next((message as ParticipantJoinedEvent).data);
        break;
      case 'participant_left':
        this.participantLeftSubject.next((message as ParticipantLeftEvent).data);
        break;
      case 'appointment_updated':
        this.appointmentUpdatedSubject.next((message as AppointmentUpdatedEvent).data);
        break;
    }
  }

  private handleConnectionError(): void {
    this.stateSubject.next(WebSocketState.FAILED);
    this.attemptReconnect();
  }

  private attemptReconnect(): void {
    if (!this.consultationId) return;
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      this.stateSubject.next(WebSocketState.FAILED);
      return;
    }

    this.stateSubject.next(WebSocketState.RECONNECTING);
    this.reconnectAttempts++;

    this.reconnectTimer = setTimeout(() => {
      if (this.consultationId) {
        this.connect(this.consultationId);
      }
    }, this.reconnectInterval);
  }

  sendMessage(content: string): void {
    if (this.socket && this.socket.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify({
        type: 'message',
        data: { content }
      }));
    }
  }

  disconnect(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    if (this.socket) {
      this.socket.close();
      this.socket = null;
    }

    this.consultationId = null;
    this.reconnectAttempts = 0;
    this.stateSubject.next(WebSocketState.DISCONNECTED);
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
