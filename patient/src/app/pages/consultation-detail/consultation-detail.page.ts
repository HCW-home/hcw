import { Component, OnInit, OnDestroy, signal } from '@angular/core';
import { CommonModule, DatePipe } from '@angular/common';
import { ActivatedRoute } from '@angular/router';
import {
  IonHeader,
  IonToolbar,
  IonButtons,
  IonButton,
  IonIcon,
  IonBackButton,
  IonContent,
  IonSpinner,
  NavController,
  ToastController
} from '@ionic/angular/standalone';
import { Subject, takeUntil } from 'rxjs';
import { ConsultationService } from '../../core/services/consultation.service';
import { ConsultationWebSocketService } from '../../core/services/consultation-websocket.service';
import { AuthService } from '../../core/services/auth.service';
import { Consultation, Appointment, User } from '../../core/models/consultation.model';
import { WebSocketState } from '../../core/models/websocket.model';
import { MessageListComponent, Message, SendMessageData, EditMessageData, DeleteMessageData } from '../../shared/components/message-list/message-list';

interface ConsultationStatus {
  label: string;
  color: 'warning' | 'info' | 'primary' | 'success' | 'muted';
}

@Component({
  selector: 'app-consultation-detail',
  templateUrl: './consultation-detail.page.html',
  styleUrls: ['./consultation-detail.page.scss'],
  standalone: true,
  imports: [
    CommonModule,
    DatePipe,
    IonHeader,
    IonToolbar,
    IonButtons,
    IonButton,
    IonIcon,
    IonBackButton,
    IonContent,
    IonSpinner,
    MessageListComponent
  ]
})
export class ConsultationDetailPage implements OnInit, OnDestroy {
  private destroy$ = new Subject<void>();
  private consultationId: number | null = null;

  consultation = signal<Consultation | null>(null);
  isLoading = signal(true);
  messages = signal<Message[]>([]);
  isConnected = signal(false);
  currentUser = signal<User | null>(null);
  isLoadingMore = signal(false);
  hasMore = signal(true);
  private currentPage = 1;

  constructor(
    private route: ActivatedRoute,
    private navCtrl: NavController,
    private consultationService: ConsultationService,
    private wsService: ConsultationWebSocketService,
    private authService: AuthService,
    private toastController: ToastController
  ) {}

  ngOnInit(): void {
    this.loadCurrentUser();
    this.setupWebSocketSubscriptions();

    this.route.params.pipe(takeUntil(this.destroy$)).subscribe(params => {
      this.consultationId = +params['id'];
      this.loadConsultation();
    });
  }

  ngOnDestroy(): void {
    this.wsService.disconnect();
    this.destroy$.next();
    this.destroy$.complete();
  }

  private loadCurrentUser(): void {
    this.authService.currentUser$
      .pipe(takeUntil(this.destroy$))
      .subscribe(user => {
        if (user) {
          this.currentUser.set(user as User);
        } else {
          this.authService.getCurrentUser().subscribe();
        }
      });
  }

  private setupWebSocketSubscriptions(): void {
    this.wsService.state$
      .pipe(takeUntil(this.destroy$))
      .subscribe(state => {
        this.isConnected.set(state === WebSocketState.CONNECTED);
      });

    this.wsService.messages$
      .pipe(takeUntil(this.destroy$))
      .subscribe(event => {
        const newMessage: Message = {
          id: event.data.id,
          username: event.data.username,
          message: event.data.message,
          timestamp: event.data.timestamp,
          isCurrentUser: false,
        };
        this.messages.update(msgs => [...msgs, newMessage]);
      });

    this.wsService.messageUpdated$
      .pipe(takeUntil(this.destroy$))
      .subscribe(event => {
        if (!this.consultationId || event.consultation_id !== this.consultationId) {
          return;
        }

        if (event.state === 'created') {
          const exists = this.messages().some(m => m.id === event.data.id);
          if (!exists) {
            const user = this.currentUser();
            const newMessage: Message = {
              id: event.data.id,
              username: `${event.data.created_by.first_name} ${event.data.created_by.last_name}`,
              message: event.data.content,
              timestamp: event.data.created_at,
              isCurrentUser: user?.id === event.data.created_by.id,
              attachment: event.data.attachment,
              isEdited: event.data.is_edited,
              updatedAt: event.data.updated_at,
            };
            this.messages.update(msgs => [...msgs, newMessage]);
          }
        } else if (event.state === 'updated' || event.state === 'deleted') {
          this.loadMessages();
        }
      });
  }

  private loadConsultation(): void {
    if (!this.consultationId) return;

    this.isLoading.set(true);
    this.consultationService.getConsultationById(this.consultationId)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (consultation) => {
          this.consultation.set(consultation);
          this.isLoading.set(false);
          this.loadMessages();
          this.wsService.connect(this.consultationId!);
        },
        error: async (error) => {
          this.isLoading.set(false);
          const toast = await this.toastController.create({
            message: error?.error?.detail || 'Failed to load consultation details',
            duration: 3000,
            position: 'bottom',
            color: 'danger'
          });
          await toast.present();
        }
      });
  }

  private loadMessages(): void {
    if (!this.consultationId) return;

    this.currentPage = 1;
    this.consultationService.getConsultationMessagesPaginated(this.consultationId, 1)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (response) => {
          this.hasMore.set(!!response.next);
          const currentUserId = this.currentUser()?.pk;
          const loadedMessages: Message[] = response.results.map(msg => {
            const isCurrentUser = msg.created_by.id === currentUserId;
            return {
              id: msg.id,
              username: isCurrentUser ? 'You' : `${msg.created_by.first_name} ${msg.created_by.last_name}`.trim(),
              message: msg.content || '',
              timestamp: msg.created_at,
              isCurrentUser,
              attachment: msg.attachment,
              isEdited: msg.is_edited,
              updatedAt: msg.updated_at,
              deletedAt: msg.deleted_at,
            };
          }).reverse();
          this.messages.set(loadedMessages);
        },
        error: async (error) => {
          const toast = await this.toastController.create({
            message: error?.error?.detail || 'Failed to load messages',
            duration: 3000,
            position: 'bottom',
            color: 'danger'
          });
          await toast.present();
        }
      });
  }

  onLoadMore(): void {
    if (!this.consultationId || this.isLoadingMore() || !this.hasMore()) return;

    this.isLoadingMore.set(true);
    this.currentPage++;

    this.consultationService.getConsultationMessagesPaginated(this.consultationId, this.currentPage)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (response) => {
          this.hasMore.set(!!response.next);
          const currentUserId = this.currentUser()?.pk;
          const olderMessages: Message[] = response.results.map(msg => {
            const isCurrentUser = msg.created_by.id === currentUserId;
            return {
              id: msg.id,
              username: isCurrentUser ? 'You' : `${msg.created_by.first_name} ${msg.created_by.last_name}`.trim(),
              message: msg.content || '',
              timestamp: msg.created_at,
              isCurrentUser,
              attachment: msg.attachment,
              isEdited: msg.is_edited,
              updatedAt: msg.updated_at,
              deletedAt: msg.deleted_at,
            };
          }).reverse();
          this.messages.update(msgs => [...olderMessages, ...msgs]);
          this.isLoadingMore.set(false);
        },
        error: async (error) => {
          this.currentPage--;
          this.isLoadingMore.set(false);
          const toast = await this.toastController.create({
            message: error?.error?.detail || 'Failed to load more messages',
            duration: 3000,
            position: 'bottom',
            color: 'danger'
          });
          await toast.present();
        }
      });
  }

  onSendMessage(data: SendMessageData): void {
    if (!this.consultationId) return;

    const tempId = Date.now();
    const newMessage: Message = {
      id: tempId,
      username: 'You',
      message: data.content || '',
      timestamp: new Date().toISOString(),
      isCurrentUser: true,
      attachment: data.attachment ? { file_name: data.attachment.name, mime_type: data.attachment.type } : null,
    };
    this.messages.update(msgs => [...msgs, newMessage]);

    this.consultationService.sendConsultationMessage(this.consultationId, data.content || '', data.attachment)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (savedMessage) => {
          this.messages.update(msgs =>
            msgs.map(m => m.id === tempId ? {
              ...m,
              id: savedMessage.id,
              attachment: savedMessage.attachment
            } : m)
          );
        },
        error: async (error) => {
          this.messages.update(msgs => msgs.filter(m => m.id !== tempId));
          const toast = await this.toastController.create({
            message: error?.error?.detail || 'Failed to send message',
            duration: 3000,
            position: 'bottom',
            color: 'danger'
          });
          await toast.present();
        }
      });
  }

  onEditMessage(data: EditMessageData): void {
    if (!this.consultationId) return;

    this.consultationService.updateConsultationMessage( data.messageId, data.content)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: async (updatedMessage) => {
          this.messages.update(msgs =>
            msgs.map(m => m.id === data.messageId ? {
              ...m,
              message: updatedMessage.content || '',
              isEdited: updatedMessage.is_edited,
              updatedAt: updatedMessage.updated_at,
            } : m)
          );
          const toast = await this.toastController.create({
            message: 'Message updated',
            duration: 2000,
            position: 'bottom',
            color: 'success'
          });
          await toast.present();
        },
        error: async (error) => {
          const toast = await this.toastController.create({
            message: error?.error?.detail || 'Failed to update message',
            duration: 3000,
            position: 'bottom',
            color: 'danger'
          });
          await toast.present();
        }
      });
  }

  onDeleteMessage(data: DeleteMessageData): void {
    this.consultationService.deleteConsultationMessage(data.messageId)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: async (deletedMessage) => {
          this.messages.update(msgs =>
            msgs.map(m => m.id === data.messageId ? {
              ...m,
              message: '',
              attachment: null,
              deletedAt: deletedMessage.deleted_at,
            } : m)
          );
          const toast = await this.toastController.create({
            message: 'Message deleted',
            duration: 2000,
            position: 'bottom',
            color: 'success'
          });
          await toast.present();
        },
        error: async (error) => {
          const toast = await this.toastController.create({
            message: error?.error?.detail || 'Failed to delete message',
            duration: 3000,
            position: 'bottom',
            color: 'danger'
          });
          await toast.present();
        }
      });
  }

  goBack(): void {
    this.navCtrl.back();
  }

  getStatusConfig(status: string | undefined): ConsultationStatus {
    const normalizedStatus = (status || 'REQUESTED').toLowerCase();
    const statusMap: Record<string, ConsultationStatus> = {
      'requested': { label: 'Requested', color: 'warning' },
      'active': { label: 'Active', color: 'success' },
      'closed': { label: 'Closed', color: 'muted' },
      'cancelled': { label: 'Cancelled', color: 'muted' }
    };
    return statusMap[normalizedStatus] || statusMap['requested'];
  }

  getReasonName(): string {
    const cons = this.consultation();
    if (cons?.reason && typeof cons.reason === 'object') {
      return cons.reason.name;
    }
    return 'Consultation';
  }

  getDoctorName(): string {
    const cons = this.consultation();
    if (cons?.owned_by) {
      return `Dr. ${cons.owned_by.first_name} ${cons.owned_by.last_name}`;
    }
    return '';
  }

  getDoctorInitial(): string {
    const cons = this.consultation();
    if (cons?.owned_by?.first_name) {
      return cons.owned_by.first_name.charAt(0).toUpperCase();
    }
    return '?';
  }

  getAppointmentTypeIcon(appointment: Appointment): string {
    return appointment.type === 'online' ? 'videocam-outline' : 'location-outline';
  }

  getAppointmentTypeLabel(appointment: Appointment): string {
    return appointment.type === 'online' ? 'Video Consultation' : 'In-person Visit';
  }

  isConsultationActive(): boolean {
    return this.consultation()?.status?.toLowerCase() === 'active';
  }

  isConsultationClosed(): boolean {
    return this.consultation()?.status?.toLowerCase() === 'closed';
  }

  joinAppointment(appointment: Appointment): void {
    this.navCtrl.navigateForward(`/consultation/${appointment.id}/video?type=appointment&consultationId=${this.consultationId}`);
  }
}
