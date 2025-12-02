import { Injectable, OnDestroy } from '@angular/core';
import { BehaviorSubject, Observable, Subject, filter, map } from 'rxjs';
import { environment } from '../../../environments/environment';
import { StorageService } from './storage.service';
import {
  WebSocketState,
  WebSocketMessage,
  UserOutgoingMessage,
  UserIncomingEvent,
  WebSocketConfig,
} from '../models/websocket.model';

@Injectable({
  providedIn: 'root'
})
export class WebSocketService implements OnDestroy {
  private socket: WebSocket | null = null;
  private reconnectAttempts = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private messageQueue: UserOutgoingMessage[] = [];

  private stateSubject = new BehaviorSubject<WebSocketState>(WebSocketState.DISCONNECTED);
  public state$ = this.stateSubject.asObservable();

  private messageSubject = new Subject<UserIncomingEvent>();
  public messages$ = this.messageSubject.asObservable();

  private config: WebSocketConfig = {
    url: '',
    reconnect: true,
    reconnectInterval: 3000,
    reconnectAttempts: 5,
    pingInterval: 30000,
  };

  constructor(private storage: StorageService) {}

  async connect(endpoint: string = '/ws/user/'): Promise<void> {
    if (this.socket && this.socket.readyState === WebSocket.OPEN) {
      return;
    }

    const token = await this.storage.get('access_token');
    if (!token) {
      this.stateSubject.next(WebSocketState.FAILED);
      return;
    }

    const wsBase = environment.apiUrl.replace(/^http/, 'ws').replace('/api', '');
    this.config.url = `${wsBase}${endpoint}?token=${token}`;

    this.stateSubject.next(WebSocketState.CONNECTING);
    this.createConnection();
  }

  private createConnection(): void {
    try {
      this.socket = new WebSocket(this.config.url);
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
      this.flushMessageQueue();
      this.startPingInterval();
    };

    this.socket.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data) as UserIncomingEvent;
        this.messageSubject.next(message);
      } catch (error) {
        // Silent fail for invalid JSON
      }
    };

    this.socket.onclose = () => {
      this.cleanup();
      this.stateSubject.next(WebSocketState.DISCONNECTED);
      this.attemptReconnect();
    };

    this.socket.onerror = () => {
      this.handleConnectionError();
    };
  }

  private handleConnectionError(): void {
    this.cleanup();
    this.stateSubject.next(WebSocketState.FAILED);
    this.attemptReconnect();
  }

  private attemptReconnect(): void {
    if (!this.config.reconnect) return;
    if (this.reconnectAttempts >= (this.config.reconnectAttempts || 5)) {
      this.stateSubject.next(WebSocketState.FAILED);
      return;
    }

    this.stateSubject.next(WebSocketState.RECONNECTING);
    this.reconnectAttempts++;

    this.reconnectTimer = setTimeout(() => {
      this.createConnection();
    }, this.config.reconnectInterval);
  }

  private startPingInterval(): void {
    this.stopPingInterval();
    this.pingTimer = setInterval(() => {
      this.send({ type: 'ping', timestamp: Date.now() });
    }, this.config.pingInterval);
  }

  private stopPingInterval(): void {
    if (this.pingTimer) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
  }

  send(message: UserOutgoingMessage): void {
    if (this.socket && this.socket.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify(message));
    } else {
      this.messageQueue.push(message);
    }
  }

  private flushMessageQueue(): void {
    while (this.messageQueue.length > 0) {
      const message = this.messageQueue.shift();
      if (message) {
        this.send(message);
      }
    }
  }

  on<T extends UserIncomingEvent>(eventType: T['type']): Observable<T> {
    return this.messages$.pipe(
      filter((msg): msg is T => msg.type === eventType)
    );
  }

  joinGroup(groupName: string): void {
    this.send({
      type: 'join_group',
      data: { group_name: groupName }
    });
  }

  leaveGroup(groupName: string): void {
    this.send({
      type: 'leave_group',
      data: { group_name: groupName }
    });
  }

  sendMessage(targetUserId: number, message: string, messageType?: string): void {
    this.send({
      type: 'send_message',
      data: {
        target_user_id: targetUserId,
        message,
        message_type: messageType
      },
      timestamp: Date.now()
    });
  }

  getStatus(): void {
    this.send({ type: 'get_status' });
  }

  disconnect(): void {
    this.config.reconnect = false;
    this.cleanup();
    if (this.socket) {
      this.socket.close();
      this.socket = null;
    }
    this.stateSubject.next(WebSocketState.DISCONNECTED);
  }

  private cleanup(): void {
    this.stopPingInterval();
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  get isConnected(): boolean {
    return this.stateSubject.value === WebSocketState.CONNECTED;
  }

  get currentState(): WebSocketState {
    return this.stateSubject.value;
  }

  ngOnDestroy(): void {
    this.disconnect();
  }
}
