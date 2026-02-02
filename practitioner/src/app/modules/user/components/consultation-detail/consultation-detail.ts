import { Component, OnInit, OnDestroy, signal, inject, computed, viewChild } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { CommonModule, Location } from '@angular/common';
import { FormBuilder, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { Subject, takeUntil } from 'rxjs';
import { FullCalendarModule, FullCalendarComponent } from '@fullcalendar/angular';
import { CalendarOptions, EventInput, EventClickArg } from '@fullcalendar/core';
import dayGridPlugin from '@fullcalendar/daygrid';
import timeGridPlugin from '@fullcalendar/timegrid';
import interactionPlugin from '@fullcalendar/interaction';

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
  AppointmentType,
  Queue,
  CreateConsultationRequest,
} from '../../../../core/models/consultation';
import { IUser } from '../../models/user';

import { Page } from '../../../../core/components/page/page';
import { Loader } from '../../../../shared/components/loader/loader';
import { MessageList, Message, SendMessageData, EditMessageData, DeleteMessageData } from '../../../../shared/components/message-list/message-list';
import { VideoConsultationComponent } from '../video-consultation/video-consultation';

import { Svg } from '../../../../shared/ui-components/svg/svg';
import { Button } from '../../../../shared/ui-components/button/button';
import { Badge } from '../../../../shared/components/badge/badge';
import { Input } from '../../../../shared/ui-components/input/input';
import { Textarea } from '../../../../shared/ui-components/textarea/textarea';
import { Select } from '../../../../shared/ui-components/select/select';
import { UserSearchSelect } from '../../../../shared/components/user-search-select/user-search-select';
import { ButtonStyleEnum, ButtonSizeEnum, ButtonStateEnum } from '../../../../shared/constants/button';
import { BadgeTypeEnum } from '../../../../shared/constants/badge';
import { SelectOption } from '../../../../shared/models/select';
import { getParticipantBadgeType, getAppointmentBadgeType } from '../../../../shared/tools/helper';
import { LocalDatePipe } from '../../../../shared/pipes/local-date.pipe';
import { getErrorMessage } from '../../../../core/utils/error-helper';
import { AppointmentFormModal } from './appointment-form-modal/appointment-form-modal';
import { RoutePaths } from '../../../../core/constants/routes';
import { ParticipantItem } from '../../../../shared/components/participant-item/participant-item';

type AppointmentViewMode = 'list' | 'calendar';
type AppointmentStatusFilter = 'all' | 'scheduled' | 'cancelled';
type AppointmentTimeFilter = 'all' | 'upcoming' | 'past';

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
    ReactiveFormsModule,
    Button,
    Badge,
    Input,
    Textarea,
    Select,
    UserSearchSelect,
    AppointmentFormModal,
    FullCalendarModule,
    LocalDatePipe,
    ParticipantItem,
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
  isLoadingMoreAppointments = signal(false);
  hasMoreAppointments = signal(false);
  private appointmentPage = 1;
  private appointmentPageSize = 20;

  messages = signal<Message[]>([]);
  isWebSocketConnected = signal(false);
  currentUser = signal<IUser | null>(null);
  isLoadingMore = signal(false);
  hasMore = signal(true);
  private currentPage = 1;

  inCall = signal(false);
  activeAppointmentId = signal<number | null>(null);
  isVideoMinimized = signal(false);

  showCreateAppointmentModal = signal(false);
  editingAppointment = signal<Appointment | null>(null);

  appointmentViewMode = signal<AppointmentViewMode>('list');
  appointmentStatusFilter = signal<AppointmentStatusFilter>('scheduled');
  appointmentTimeFilter = signal<AppointmentTimeFilter>('upcoming');
  calendarComponent = viewChild<FullCalendarComponent>('appointmentCalendar');

  calendarEvents = computed<EventInput[]>(() => {
    return this.appointments().map(appointment => ({
      id: appointment.id.toString(),
      title: this.getCalendarEventTitle(appointment),
      start: appointment.scheduled_at,
      end: appointment.end_expected_at || undefined,
      backgroundColor: this.getStatusColor(appointment.status),
      borderColor: this.getStatusColor(appointment.status),
      textColor: '#ffffff',
      extendedProps: { appointment }
    }));
  });

  calendarOptions: CalendarOptions = {
    plugins: [dayGridPlugin, timeGridPlugin, interactionPlugin],
    initialView: 'dayGridMonth',
    headerToolbar: false,
    height: 'auto',
    weekends: true,
    editable: false,
    selectable: false,
    dayMaxEvents: 3,
    eventClick: this.handleCalendarEventClick.bind(this),
    slotMinTime: '06:00:00',
    slotMaxTime: '22:00:00',
    allDaySlot: false,
    nowIndicator: true,
    eventTimeFormat: {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false
    }
  };

  isEditMode = signal(false);
  isSavingConsultation = signal(false);
  queues = signal<Queue[]>([]);
  editForm!: FormGroup;
  selectedBeneficiary = signal<IUser | null>(null);
  selectedOwner = signal<IUser | null>(null);

  private fb = inject(FormBuilder);

  queueOptions = computed<SelectOption[]>(() =>
    this.queues().map(queue => ({
      value: queue.id.toString(),
      label: queue.name,
    }))
  );

  protected readonly AppointmentStatus = AppointmentStatus;
  protected readonly AppointmentType = AppointmentType;
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
    this.initEditForm();
    this.loadQueues();

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

  private initEditForm(): void {
    this.editForm = this.fb.group({
      title: [''],
      description: [''],
      beneficiary_id: [''],
      owned_by_id: [''],
      group_id: [''],
    });
  }

  private loadQueues(): void {
    this.consultationService
      .getQueues()
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: queues => {
          this.queues.set(queues);
        },
        error: (error) => {
          this.toasterService.show('error', getErrorMessage(error));
        },
      });
  }

  private checkJoinQueryParam(): void {
    this.route.queryParams.pipe(takeUntil(this.destroy$)).subscribe(queryParams => {
      if (queryParams['join'] === 'true' && queryParams['appointmentId']) {
        const appointmentId = +queryParams['appointmentId'];
        this.joinVideoCall(appointmentId);
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
    this.appointmentPage = 1;
    const statusFilter = this.appointmentStatusFilter();
    const timeFilter = this.appointmentTimeFilter();
    const params: { status?: string; future?: boolean; page?: number; page_size?: number } = {
      page: 1,
      page_size: this.appointmentPageSize
    };
    if (statusFilter !== 'all') {
      params.status = statusFilter;
    }
    if (timeFilter === 'upcoming') {
      params.future = true;
    } else if (timeFilter === 'past') {
      params.future = false;
    }
    this.consultationService
      .getConsultationAppointments(this.consultationId, params)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: response => {
          this.appointments.set(response.results);
          this.hasMoreAppointments.set(response.next !== null);
          this.isLoadingAppointments.set(false);
        },
        error: (error) => {
          this.isLoadingAppointments.set(false);
          this.toasterService.show('error', getErrorMessage(error));
        },
      });
  }

  loadMoreAppointments(): void {
    if (this.isLoadingMoreAppointments() || !this.hasMoreAppointments()) return;

    this.isLoadingMoreAppointments.set(true);
    this.appointmentPage++;
    const statusFilter = this.appointmentStatusFilter();
    const timeFilter = this.appointmentTimeFilter();
    const params: { status?: string; future?: boolean; page?: number; page_size?: number } = {
      page: this.appointmentPage,
      page_size: this.appointmentPageSize
    };
    if (statusFilter !== 'all') {
      params.status = statusFilter;
    }
    if (timeFilter === 'upcoming') {
      params.future = true;
    } else if (timeFilter === 'past') {
      params.future = false;
    }
    this.consultationService
      .getConsultationAppointments(this.consultationId, params)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: response => {
          const currentAppointments = this.appointments();
          this.appointments.set([...currentAppointments, ...response.results]);
          this.hasMoreAppointments.set(response.next !== null);
          this.isLoadingMoreAppointments.set(false);
        },
        error: (error) => {
          this.appointmentPage--;
          this.isLoadingMoreAppointments.set(false);
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

  async cancelAppointment(appointment: Appointment): Promise<void> {
    const confirmed = await this.confirmationService.confirm({
      title: 'Cancel Appointment',
      message: 'Are you sure you want to cancel this appointment?',
      confirmText: 'Cancel Appointment',
      cancelText: 'Go Back',
      confirmStyle: 'danger',
    });

    if (confirmed) {
      this.consultationService
        .updateAppointment(appointment.id, { status: AppointmentStatus.CANCELLED })
        .pipe(takeUntil(this.destroy$))
        .subscribe({
          next: (updatedAppointment) => {
            const currentAppointments = this.appointments();
            this.appointments.set(
              currentAppointments.map(a => a.id === appointment.id ? updatedAppointment : a)
            );
            this.toasterService.show('success', 'Appointment cancelled successfully');
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
          next: () => {
            this.toasterService.show('success', 'Consultation closed successfully');
            this.router.navigate([`/${RoutePaths.USER}/${RoutePaths.CONSULTATIONS}`]);
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
    const currentConsultation = this.consultation();
    if (!currentConsultation) return;

    this.editForm.patchValue({
      title: currentConsultation.title || '',
      description: currentConsultation.description || '',
      beneficiary_id: currentConsultation.beneficiary?.id || '',
      owned_by_id: currentConsultation.owned_by?.id || '',
      group_id: currentConsultation.group?.id?.toString() || '',
    });

    this.selectedBeneficiary.set(currentConsultation.beneficiary ? {
      pk: currentConsultation.beneficiary.id,
      email: currentConsultation.beneficiary.email,
      first_name: currentConsultation.beneficiary.first_name,
      last_name: currentConsultation.beneficiary.last_name,
    } as IUser : null);

    this.selectedOwner.set(currentConsultation.owned_by ? {
      pk: currentConsultation.owned_by.id,
      email: currentConsultation.owned_by.email,
      first_name: currentConsultation.owned_by.first_name,
      last_name: currentConsultation.owned_by.last_name,
    } as IUser : null);

    this.isEditMode.set(true);
  }

  cancelEdit(): void {
    this.isEditMode.set(false);
    this.selectedBeneficiary.set(null);
    this.selectedOwner.set(null);
  }

  onBeneficiarySelected(user: IUser | null): void {
    this.selectedBeneficiary.set(user);
    this.editForm.patchValue({ beneficiary_id: user?.pk || '' });
  }

  onOwnerSelected(user: IUser | null): void {
    this.selectedOwner.set(user);
    this.editForm.patchValue({ owned_by_id: user?.pk || '' });
  }

  saveConsultationChanges(): void {
    if (!this.consultationId) return;

    this.isSavingConsultation.set(true);
    const formValue = this.editForm.value;

    const updateData: Partial<CreateConsultationRequest> = {
      title: formValue.title || null,
      description: formValue.description || null,
      beneficiary_id: formValue.beneficiary_id ? Number(formValue.beneficiary_id) : null,
      owned_by_id: formValue.owned_by_id ? Number(formValue.owned_by_id) : null,
      group_id: formValue.group_id ? Number(formValue.group_id) : null,
    };

    this.consultationService
      .updateConsultation(this.consultationId, updateData)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (updatedConsultation) => {
          this.consultation.set(updatedConsultation);
          this.isSavingConsultation.set(false);
          this.isEditMode.set(false);
          this.toasterService.show('success', 'Consultation updated successfully');
        },
        error: (error) => {
          this.isSavingConsultation.set(false);
          this.toasterService.show('error', getErrorMessage(error));
        },
      });
  }
  getUserDisplayName(participant: Participant): string {
    if (participant.user) {
      const fullName = `${participant.user.first_name || ''} ${participant.user.last_name || ''}`.trim();
      return fullName || participant.user.email || 'Unknown';
    }
    return 'Unknown';
  }

  getBeneficiaryDisplayName(): string {
    const beneficiary = this.consultation()?.beneficiary;
    if (!beneficiary) return 'No beneficiary assigned';

    const firstName = beneficiary.first_name?.trim() || '';
    const lastName = beneficiary.last_name?.trim() || '';
    const fullName = `${firstName} ${lastName}`.trim();

    return fullName || beneficiary.email || 'Unknown patient';
  }

  joinVideoCall(appointmentId: number): void {
    this.activeAppointmentId.set(appointmentId);
    this.inCall.set(true);
  }

  onCallEnded(): void {
    this.inCall.set(false);
    this.activeAppointmentId.set(null);
    this.isVideoMinimized.set(false);
  }

  toggleVideoSize(): void {
    this.isVideoMinimized.update(v => !v);
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

  getParticipantInitials(participant: Participant): string {
    if (participant.user) {
      const first = participant.user.first_name?.charAt(0) || '';
      const last = participant.user.last_name?.charAt(0) || '';
      if (first || last) {
        return (first + last).toUpperCase();
      }
      if (participant.user.email) {
        return participant.user.email.charAt(0).toUpperCase();
      }
    }
    return '?';
  }

  getLanguageLabel(code: string): string {
    const languages: Record<string, string> = {
      en: 'English',
      de: 'German',
      fr: 'French',
    };
    return languages[code] || code;
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

  setAppointmentViewMode(mode: AppointmentViewMode): void {
    this.appointmentViewMode.set(mode);
  }

  setAppointmentStatusFilter(filter: AppointmentStatusFilter): void {
    this.appointmentStatusFilter.set(filter);
    this.loadAppointments();
  }

  setAppointmentTimeFilter(tabId: string): void {
    this.appointmentTimeFilter.set(tabId as AppointmentTimeFilter);
    this.loadAppointments();
  }

  private getCalendarEventTitle(appointment: Appointment): string {
    const typeLabel = appointment.type === AppointmentType.ONLINE ? 'Video' : 'In Person';
    return typeLabel;
  }

  private getStatusColor(status: AppointmentStatus): string {
    switch (status) {
      case AppointmentStatus.SCHEDULED:
        return '#3b82f6';
      case AppointmentStatus.CANCELLED:
        return '#ef4444';
      case AppointmentStatus.DRAFT:
        return '#f59e0b';
      default:
        return '#6b7280';
    }
  }

  handleCalendarEventClick(clickInfo: EventClickArg): void {
    const appointment = clickInfo.event.extendedProps['appointment'] as Appointment;
    if (appointment) {
      this.openEditAppointmentModal(appointment);
    }
  }

  calendarPrev(): void {
    const calendarApi = this.calendarComponent()?.getApi();
    if (calendarApi) {
      calendarApi.prev();
    }
  }

  calendarNext(): void {
    const calendarApi = this.calendarComponent()?.getApi();
    if (calendarApi) {
      calendarApi.next();
    }
  }

  calendarToday(): void {
    const calendarApi = this.calendarComponent()?.getApi();
    if (calendarApi) {
      calendarApi.today();
    }
  }

  getCalendarTitle(): string {
    const calendarApi = this.calendarComponent()?.getApi();
    return calendarApi?.view.title || '';
  }
}
