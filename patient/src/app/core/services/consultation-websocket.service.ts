import { Injectable, OnDestroy } from '@angular/core';
import { BehaviorSubject, Observable, Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import { UserWebSocketService } from './user-websocket.service';
import { WebSocketService } from './websocket.service';
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
  private consultationId: number | null = null;
  private destroy$ = new Subject<void>();

  public state$: Observable<WebSocketState>;

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

  constructor(
    private userWsService: UserWebSocketService,
    private wsService: WebSocketService
  ) {
    this.state$ = this.userWsService.getConnectionState();
    this.setupEventListeners();
  }

  connect(consultationId: number): void {
    if (this.consultationId === consultationId) {
      return;
    }

    this.consultationId = consultationId;
  }

  disconnect(): void {
    this.consultationId = null;
    this.participantsSubject.next([]);
  }

  send(message: unknown): void {
    this.wsService.send(message as Parameters<typeof this.wsService.send>[0]);
  }

  get isConnected(): boolean {
    return this.userWsService.isConnected();
  }

  private setupEventListeners(): void {
    this.wsService.messages$
      .pipe(takeUntil(this.destroy$))
      .subscribe((event) => {
        this.handleMessage(event as unknown as ConsultationIncomingEvent);
      });
  }

  private handleMessage(message: ConsultationIncomingEvent): void {
    this.allEventsSubject.next(message);

    const msgAny = message as unknown as Record<string, unknown>;
    const consultationId = msgAny['consultation_id'] as number | undefined;

    if (consultationId && this.consultationId && consultationId !== this.consultationId) {
      return;
    }

    const eventType = msgAny['event'] as string | undefined;
    const messageType = msgAny['type'] as string | undefined;

    if (eventType === 'message') {
      this.messageUpdatedSubject.next(message as WsMessageEvent);
      return;
    }

    if (eventType === 'consultation') {
      return;
    }

    if (eventType === 'appointment') {
      this.appointmentUpdatedSubject.next(message as AppointmentUpdatedEvent);
      return;
    }

    switch (messageType) {
      case 'participants':
        this.participantsSubject.next((message as { type: string; data: ConsultationParticipant[] }).data);
        break;

      case 'consultation_message':
        this.messagesSubject.next(message as ConsultationMessageEvent);
        break;

      case 'participant_joined':
        this.participantJoinedSubject.next(message as ParticipantJoinedEvent);
        break;

      case 'participant_left':
        this.participantLeftSubject.next(message as ParticipantLeftEvent);
        break;
    }
  }

  ngOnDestroy(): void {
    this.disconnect();
    this.destroy$.next();
    this.destroy$.complete();
  }
}
