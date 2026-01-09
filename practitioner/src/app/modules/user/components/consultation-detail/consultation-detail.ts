import { Component, OnInit, OnDestroy, signal, inject } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { CommonModule, Location } from '@angular/common';
import { Subject, takeUntil } from 'rxjs';

import { ConsultationService } from '../../../../core/services/consultation.service';
import { ConfirmationService } from '../../../../core/services/confirmation.service';
import { ToasterService } from '../../../../core/services/toaster.service';
import { ConsultationWebSocketService } from '../../../../core/services/consultation-websocket.service';
import { UserService } from '../../../../core/services/user.service';
import {
  Consultation,
  Appointment,
  Participant,
  AppointmentStatus,
} from '../../../../core/models/consultation';
import { IUser } from '../../models/user';

import { Page } from '../../../../core/components/page/page';
import { Loader } from '../../../../shared/components/loader/loader';
import { MessageList, Message, SendMessageData, EditMessageData, DeleteMessageData } from '../../../../shared/components/message-list/message-list';
import { VideoConsultationComponent } from '../video-consultation/video-consultation';

import { Svg } from '../../../../shared/ui-components/svg/svg';
import { Button } from '../../../../shared/ui-components/button/button';
import { Badge } from '../../../../shared/components/badge/badge';
import { ButtonStyleEnum, ButtonSizeEnum, ButtonStateEnum } from '../../../../shared/constants/button';
import { BadgeTypeEnum } from '../../../../shared/constants/badge';
import { getParticipantBadgeType, getAppointmentBadgeType } from '../../../../shared/tools/helper';
import { getErrorMessage } from '../../../../core/utils/error-helper';
import { AppointmentFormModal } from './appointment-form-modal/appointment-form-modal';
import { ManageParticipantsModal } from './manage-participants-modal/manage-participants-modal';

@Component({
  selector: 'app-consultation-detail',
  templateUrl: './consultation-detail.html',
  styleUrl: './consultation-detail.scss',
  imports: [
    Svg,
    Page,
    Loader,
    MessageList,
    VideoConsultationComponent,
    CommonModule,
    Button,
    Badge,
    AppointmentFormModal,
    ManageParticipantsModal,
  ],
})
export class ConsultationDetail implements OnInit, OnDestroy {
  private destroy$ = new Subject<void>();
  private location = inject(Location);

  consultationId!: number;
  consultation = signal<Consultation | null>(null);
  appointments = signal<Appointment[]>([]);
  selectedAppointment = signal<Appointment | null>(null);

  isLoadingConsultation = signal(false);
  isLoadingAppointments = signal(false);

  messages = signal<Message[]>([]);
  isWebSocketConnected = signal(false);
  currentUser = signal<IUser | null>(null);
  isLoadingMore = signal(false);
  hasMore = signal(true);
  private currentPage = 1;

  inCall = signal(false);
  activeAppointmentId = signal<number | null>(null);

  showCreateAppointmentModal = signal(false);
  showManageParticipantsModal = signal(false);
  editingAppointment = signal<Appointment | null>(null);

  protected readonly AppointmentStatus = AppointmentStatus;
  protected readonly ButtonStyleEnum = ButtonStyleEnum;
  protected readonly ButtonSizeEnum = ButtonSizeEnum;
  protected readonly ButtonStateEnum = ButtonStateEnum;
  protected readonly BadgeTypeEnum = BadgeTypeEnum;
  protected readonly getParticipantBadgeType = getParticipantBadgeType;
  protected readonly getAppointmentBadgeType = getAppointmentBadgeType;

  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private consultationService = inject(ConsultationService);
  private confirmationService = inject(ConfirmationService);
  private toasterService = inject(ToasterService);
  private wsService = inject(ConsultationWebSocketService);
  private userService = inject(UserService);

  ngOnInit(): void {
    this.userService.currentUser$.pipe(takeUntil(this.destroy$)).subscribe(user => {
      this.currentUser.set(user);
    });

    this.route.params.pipe(takeUntil(this.destroy$)).subscribe(params => {
      this.consultationId = +params['id'];
      this.loadConsultation();
      this.loadAppointments();
      this.loadMessages();
      this.connectWebSocket();
      this.checkJoinQueryParam();
    });

    this.setupWebSocketListeners();
  }

  private checkJoinQueryParam(): void {
    this.route.queryParams.pipe(takeUntil(this.destroy$)).subscribe(queryParams => {
      if (queryParams['join'] === 'true') {
        const appointmentId = queryParams['appointmentId'] ? +queryParams['appointmentId'] : null;
        this.joinVideoCall(appointmentId ?? undefined);
      }
    });
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
    this.wsService.disconnect();
  }

  private connectWebSocket(): void {
    this.wsService.connect(this.consultationId);
  }

  private setupWebSocketListeners(): void {
    this.wsService.state$.pipe(takeUntil(this.destroy$)).subscribe(state => {
      this.isWebSocketConnected.set(state === 'CONNECTED');
    });

    this.wsService.messages$.pipe(takeUntil(this.destroy$)).subscribe(event => {
      const newMessage: Message = {
        id: event.data.id,
        username: event.data.username,
        message: event.data.message,
        timestamp: event.data.timestamp,
        isCurrentUser: false,
        isEdited: event.data.is_edited,
        updatedAt: event.data.updated_at,
      };
      this.messages.update(msgs => [...msgs, newMessage]);
    });

    this.wsService.messageUpdated$.pipe(takeUntil(this.destroy$)).subscribe(event => {
      if (event.state === 'created') {
        const exists = this.messages().some(m => m.id === event.data.id);
        if (!exists) {
          const currentUser = this.currentUser();
          const newMessage: Message = {
            id: event.data.id,
            username: `${event.data.created_by.first_name} ${event.data.created_by.last_name}`,
            message: event.data.content,
            timestamp: event.data.created_at,
            isCurrentUser: currentUser?.pk === event.data.created_by.id,
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

    this.wsService.participantJoined$.pipe(takeUntil(this.destroy$)).subscribe(event => {
      this.toasterService.show('success', 'Participant Joined', `${event.data.username} joined the consultation`);
      this.loadAppointments();
    });

    this.wsService.participantLeft$.pipe(takeUntil(this.destroy$)).subscribe(event => {
      this.toasterService.show('warning', 'Participant Left', `${event.data.username} left the consultation`);
      this.loadAppointments();
    });

    this.wsService.appointmentUpdated$.pipe(takeUntil(this.destroy$)).subscribe(() => {
      this.toasterService.show('success', 'Appointment Updated', 'An appointment has been updated');
      this.loadAppointments();
    });
  }

  onSendMessage(data: SendMessageData): void {
    const user = this.currentUser();
    const tempId = Date.now();
    const newMessage: Message = {
      id: tempId,
      username: user?.first_name || user?.email || 'You',
      message: data.content || '',
      timestamp: new Date().toISOString(),
      isCurrentUser: true,
      attachment: data.attachment ? { file_name: data.attachment.name, mime_type: data.attachment.type } : null,
    };
    this.messages.update(msgs => [...msgs, newMessage]);

    this.consultationService
      .sendConsultationMessage(this.consultationId, { content: data.content, attachment: data.attachment })
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (savedMessage) => {
          this.messages.update(msgs =>
            msgs.map(m => m.id === tempId ? { ...m, id: savedMessage.id, attachment: savedMessage.attachment } : m)
          );
        },
        error: (error) => {
          this.toasterService.show('error', getErrorMessage(error));
          this.messages.update(msgs => msgs.filter(m => m.id !== tempId));
        },
      });
  }

  loadMessages(): void {
    this.currentPage = 1;
    this.consultationService
      .getConsultationMessages(this.consultationId, { page: 1 })
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: response => {
          this.hasMore.set(!!response.next);
          const currentUserId = this.currentUser()?.pk;
          const loadedMessages: Message[] = response.results.map(msg => {
            const isCurrentUser = msg.created_by.id === currentUserId;
            const username = isCurrentUser
              ? 'You'
              : `${msg.created_by.first_name} ${msg.created_by.last_name}`.trim() || msg.created_by.email;
            return {
              id: msg.id,
              username,
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
        error: (error) => {
          this.toasterService.show('error', getErrorMessage(error));
        },
      });
  }

  onLoadMore(): void {
    if (this.isLoadingMore() || !this.hasMore()) return;

    this.isLoadingMore.set(true);
    this.currentPage++;

    this.consultationService
      .getConsultationMessages(this.consultationId, { page: this.currentPage })
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: response => {
          this.hasMore.set(!!response.next);
          const currentUserId = this.currentUser()?.pk;
          const olderMessages: Message[] = response.results.map(msg => {
            const isCurrentUser = msg.created_by.id === currentUserId;
            const username = isCurrentUser
              ? 'You'
              : `${msg.created_by.first_name} ${msg.created_by.last_name}`.trim() || msg.created_by.email;
            return {
              id: msg.id,
              username,
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
        error: (error) => {
          this.currentPage--;
          this.isLoadingMore.set(false);
          this.toasterService.show('error', getErrorMessage(error));
        },
      });
  }

  loadConsultation(): void {
    this.isLoadingConsultation.set(true);
    this.consultationService
      .getConsultation(this.consultationId)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: consultation => {
          this.consultation.set(consultation);
          this.isLoadingConsultation.set(false);
        },
        error: (error) => {
          this.isLoadingConsultation.set(false);
          this.toasterService.show('error', getErrorMessage(error));
        },
      });
  }

  loadAppointments(): void {
    this.isLoadingAppointments.set(true);
    this.consultationService
      .getConsultationAppointments(this.consultationId)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: response => {
          this.appointments.set(response.results);
          this.isLoadingAppointments.set(false);
        },
        error: (error) => {
          this.isLoadingAppointments.set(false);
          this.toasterService.show('error', getErrorMessage(error));
        },
      });
  }

  sendAppointment(appointment: Appointment): void {
    this.consultationService
      .sendAppointment(appointment.id)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: updatedAppointment => {
          const currentAppointments = this.appointments();
          const updatedAppointments = currentAppointments.map(a =>
            a.id === appointment.id ? updatedAppointment : a
          );
          this.appointments.set(updatedAppointments);
          this.toasterService.show('success', 'Appointment sent successfully');
        },
        error: (error) => {
          this.toasterService.show('error', getErrorMessage(error));
        },
      });
  }

  async deleteAppointment(appointment: Appointment): Promise<void> {
    const confirmed = await this.confirmationService.confirm({
      title: 'Delete Appointment',
      message: 'Are you sure you want to delete this appointment? This action cannot be undone.',
      confirmText: 'Delete',
      cancelText: 'Cancel',
      confirmStyle: 'danger',
    });

    if (confirmed) {
      this.consultationService
        .deleteAppointment(appointment.id)
        .pipe(takeUntil(this.destroy$))
        .subscribe({
          next: () => {
            const currentAppointments = this.appointments();
            this.appointments.set(currentAppointments.filter(a => a.id !== appointment.id));
            this.toasterService.show('success', 'Appointment deleted successfully');
          },
          error: (error) => {
            this.toasterService.show('error', getErrorMessage(error));
          },
        });
    }
  }

  async closeConsultation(): Promise<void> {
    if (!this.consultation()) return;

    const confirmed = await this.confirmationService.confirm({
      title: 'Close Consultation',
      message: 'Are you sure you want to close this consultation?',
      confirmText: 'Close',
      cancelText: 'Cancel',
      confirmStyle: 'danger',
    });

    if (confirmed) {
      this.consultationService
        .closeConsultation(this.consultationId)
        .pipe(takeUntil(this.destroy$))
        .subscribe({
          next: updatedConsultation => {
            this.consultation.set(updatedConsultation);
            this.toasterService.show('success', 'Consultation closed successfully');
          },
          error: (error) => {
            this.toasterService.show('error', getErrorMessage(error));
          },
        });
    }
  }

  async reopenConsultation(): Promise<void> {
    if (!this.consultation()) return;

    const confirmed = await this.confirmationService.confirm({
      title: 'Reopen Consultation',
      message: 'Are you sure you want to reopen this consultation?',
      confirmText: 'Reopen',
      cancelText: 'Cancel',
      confirmStyle: 'primary',
    });

    if (confirmed) {
      this.consultationService
        .reopenConsultation(this.consultationId)
        .pipe(takeUntil(this.destroy$))
        .subscribe({
          next: updatedConsultation => {
            this.consultation.set(updatedConsultation);
            this.toasterService.show('success', 'Consultation reopened successfully');
          },
          error: (error) => {
            this.toasterService.show('error', getErrorMessage(error));
          },
        });
    }
  }

  editConsultation(): void {
    this.router.navigate(['/app/consultations', this.consultationId, 'edit']);
  }

  formatDateTime(dateString: string): string {
    return new Date(dateString).toLocaleString();
  }

  getUserDisplayName(participant: Participant): string {
    if (participant.user) {
      return (
        `${participant.user.first_name} ${participant.user.last_name}`.trim() ||
        participant.user.email
      );
    }
    return participant.email || 'Unknown';
  }

  getBeneficiaryDisplayName(): string {
    const beneficiary = this.consultation()?.beneficiary;
    if (!beneficiary) return 'No beneficiary assigned';

    const firstName = beneficiary.first_name?.trim() || '';
    const lastName = beneficiary.last_name?.trim() || '';
    const fullName = `${firstName} ${lastName}`.trim();

    return fullName || beneficiary.email || 'Unknown patient';
  }

  joinVideoCall(appointmentId?: number): void {
    this.activeAppointmentId.set(appointmentId || null);
    this.inCall.set(true);
  }

  onCallEnded(): void {
    this.inCall.set(false);
    this.activeAppointmentId.set(null);
  }

  goBack(): void {
    this.location.back();
  }

  openCreateAppointmentModal(): void {
    this.editingAppointment.set(null);
    this.showCreateAppointmentModal.set(true);
  }

  openEditAppointmentModal(appointment: Appointment): void {
    this.editingAppointment.set(appointment);
    this.showCreateAppointmentModal.set(true);
  }

  closeCreateAppointmentModal(): void {
    this.showCreateAppointmentModal.set(false);
    this.editingAppointment.set(null);
  }

  onAppointmentCreated(appointment: Appointment): void {
    const currentAppointments = this.appointments();
    this.appointments.set([...currentAppointments, appointment]);
    this.loadAppointments();
  }

  onAppointmentUpdated(updatedAppointment: Appointment): void {
    const currentAppointments = this.appointments();
    const updatedAppointments = currentAppointments.map(a =>
      a.id === updatedAppointment.id ? updatedAppointment : a
    );
    this.appointments.set(updatedAppointments);
  }

  openManageParticipantsModal(appointment: Appointment): void {
    this.selectedAppointment.set(appointment);
    this.showManageParticipantsModal.set(true);
  }

  closeManageParticipantsModal(): void {
    this.showManageParticipantsModal.set(false);
    this.loadAppointments();
  }

  getParticipantInitials(participant: Participant): string {
    if (participant.user) {
      const first = participant.user.first_name?.charAt(0) || '';
      const last = participant.user.last_name?.charAt(0) || '';
      return (first + last).toUpperCase() || '?';
    }
    if (participant.email) {
      return participant.email.charAt(0).toUpperCase();
    }
    return '?';
  }

  onEditMessage(data: EditMessageData): void {
    this.consultationService
      .updateConsultationMessage(data.messageId, data.content)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (updatedMessage) => {
          this.messages.update(msgs =>
            msgs.map(m => m.id === data.messageId ? {
              ...m,
              message: updatedMessage.content || '',
              isEdited: updatedMessage.is_edited,
              updatedAt: updatedMessage.updated_at
            } : m)
          );
          this.toasterService.show('success', 'Message updated');
        },
        error: (error) => {
          this.toasterService.show('error', getErrorMessage(error));
        },
      });
  }

  onDeleteMessage(data: DeleteMessageData): void {
    this.consultationService
      .deleteConsultationMessage(data.messageId)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (deletedMessage) => {
          this.messages.update(msgs =>
            msgs.map(m => m.id === data.messageId ? {
              ...m,
              message: '',
              attachment: null,
              deletedAt: deletedMessage.deleted_at
            } : m)
          );
          this.toasterService.show('success', 'Message deleted');
        },
        error: (error) => {
          this.toasterService.show('error', getErrorMessage(error));
        },
      });
  }
}
