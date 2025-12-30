import { Injectable, OnDestroy } from '@angular/core';
import { BehaviorSubject, Observable, Subject } from 'rxjs';
import { WebSocketService } from './websocket.service';
import { Auth } from './auth';
import { environment } from '../../../environments/environment';
import {
  WebSocketState,
  UserMessageEvent,
  NotificationEvent,
  StatusChangedEvent,
} from '../models/websocket';

@Injectable({
  providedIn: 'root',
})
export class UserWebSocketService implements OnDestroy {
  private isOnlineSubject = new BehaviorSubject<boolean>(false);
  private connectionCountSubject = new BehaviorSubject<number>(0);
  private messagesSubject = new Subject<UserMessageEvent>();
  private notificationsSubject = new Subject<NotificationEvent>();

  public isOnline$: Observable<boolean> = this.isOnlineSubject.asObservable();
  public connectionCount$: Observable<number> =
    this.connectionCountSubject.asObservable();
  public messages$: Observable<UserMessageEvent> =
    this.messagesSubject.asObservable();
  public notifications$: Observable<NotificationEvent> =
    this.notificationsSubject.asObservable();

  constructor(
    private wsService: WebSocketService,
    private authService: Auth
  ) {
    this.setupEventListeners();
  }

  connect(): void {
    const state = this.wsService.getState();
    if (state === WebSocketState.CONNECTED || state === WebSocketState.CONNECTING) {
      return;
    }

    const token = this.authService.getToken();
    if (!token) {
      return;
    }

    const wsUrl = `${environment.wsUrl}/user/?token=${token}`;
    this.wsService.connect({
      url: wsUrl,
      reconnect: true,
      reconnectAttempts: 10,
      reconnectInterval: 3000,
      pingInterval: 30000,
    });
  }

  disconnect(): void {
    this.wsService.disconnect();
    this.isOnlineSubject.next(false);
    this.connectionCountSubject.next(0);
  }

  getConnectionState(): Observable<WebSocketState> {
    return this.wsService.state$;
  }

  isConnected(): boolean {
    return this.wsService.isConnected();
  }

  joinConsultationGroup(consultationId: number): void {
    this.wsService.joinGroup(`consultation_${consultationId}`);
  }

  leaveConsultationGroup(consultationId: number): void {
    this.wsService.leaveGroup(`consultation_${consultationId}`);
  }

  sendMessage(targetUserId: number, message: string): void {
    this.wsService.send({
      type: 'send_message',
      data: {
        target_user_id: targetUserId,
        message,
      },
      timestamp: Date.now(),
    });
  }

  private setupEventListeners(): void {
    this.wsService.on('status_changed').subscribe((event: StatusChangedEvent) => {
      this.isOnlineSubject.next(event.data.is_online);
      this.connectionCountSubject.next(event.data.connection_count);
    });

    this.wsService.on('user_message').subscribe((event: UserMessageEvent) => {
      this.messagesSubject.next(event);
    });

    this.wsService.on('notification').subscribe((event: NotificationEvent) => {
      this.notificationsSubject.next(event);
    });

    this.wsService.on('error').subscribe((event) => {
      console.error('WebSocket error:', event.message);
    });
  }

  ngOnDestroy(): void {
    this.disconnect();
  }
}
