import { Injectable, OnDestroy } from '@angular/core';
import { BehaviorSubject, Observable, Subject, Subscription } from 'rxjs';
import { filter, map } from 'rxjs/operators';
import { WebSocketService } from './websocket.service';
import { AuthService } from './auth.service';
import {
  WebSocketState,
  UserMessageEvent,
  NotificationEvent,
  StatusResponseEvent,
} from '../models/websocket.model';

@Injectable({
  providedIn: 'root'
})
export class UserWebSocketService implements OnDestroy {
  private subscriptions: Subscription[] = [];
  private joinedGroups: Set<string> = new Set();

  private isOnlineSubject = new BehaviorSubject<boolean>(false);
  public isOnline$ = this.isOnlineSubject.asObservable();

  private connectionCountSubject = new BehaviorSubject<number>(0);
  public connectionCount$ = this.connectionCountSubject.asObservable();

  private userMessagesSubject = new Subject<UserMessageEvent['data']>();
  public userMessages$ = this.userMessagesSubject.asObservable();

  private notificationsSubject = new Subject<NotificationEvent['data']>();
  public notifications$ = this.notificationsSubject.asObservable();

  constructor(
    private wsService: WebSocketService,
    private authService: AuthService
  ) {
    this.setupAuthListener();
  }

  private setupAuthListener(): void {
    const authSub = this.authService.isAuthenticated$.subscribe(isAuth => {
      if (isAuth) {
        this.connect();
      } else {
        this.disconnect();
      }
    });
    this.subscriptions.push(authSub);
  }

  async connect(): Promise<void> {
    await this.wsService.connect('/ws/user/');
    this.setupMessageHandlers();
  }

  private setupMessageHandlers(): void {
    const statusSub = this.wsService.on<StatusResponseEvent>('status_response')
      .subscribe(event => {
        this.isOnlineSubject.next(event.data.is_online);
        this.connectionCountSubject.next(event.data.connection_count);
      });

    const messageSub = this.wsService.on<UserMessageEvent>('user_message')
      .subscribe(event => {
        this.userMessagesSubject.next(event.data);
      });

    const notifSub = this.wsService.on<NotificationEvent>('notification')
      .subscribe(event => {
        this.notificationsSubject.next(event.data);
      });

    const connectedSub = this.wsService.state$
      .pipe(filter(state => state === WebSocketState.CONNECTED))
      .subscribe(() => {
        this.wsService.getStatus();
        this.rejoinGroups();
      });

    this.subscriptions.push(statusSub, messageSub, notifSub, connectedSub);
  }

  joinConsultationGroup(consultationId: number): void {
    const groupName = `consultation_${consultationId}`;
    this.wsService.joinGroup(groupName);
    this.joinedGroups.add(groupName);
  }

  leaveConsultationGroup(consultationId: number): void {
    const groupName = `consultation_${consultationId}`;
    this.wsService.leaveGroup(groupName);
    this.joinedGroups.delete(groupName);
  }

  sendMessage(targetUserId: number, message: string): void {
    this.wsService.sendMessage(targetUserId, message);
  }

  private rejoinGroups(): void {
    this.joinedGroups.forEach(group => {
      this.wsService.joinGroup(group);
    });
  }

  disconnect(): void {
    this.joinedGroups.clear();
    this.wsService.disconnect();
    this.isOnlineSubject.next(false);
    this.connectionCountSubject.next(0);
  }

  get state$(): Observable<WebSocketState> {
    return this.wsService.state$;
  }

  get isConnected(): boolean {
    return this.wsService.isConnected;
  }

  ngOnDestroy(): void {
    this.subscriptions.forEach(sub => sub.unsubscribe());
    this.disconnect();
  }
}
