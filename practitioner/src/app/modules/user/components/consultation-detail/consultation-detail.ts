import { Component, OnInit, OnDestroy, signal, inject } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import {
  FormBuilder,
  FormGroup,
  Validators,
  ReactiveFormsModule,
} from '@angular/forms';
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
  AppointmentType,
  CreateAppointmentRequest,
} from '../../../../core/models/consultation';
import { IUser } from '../../models/user';

import { Page } from '../../../../core/components/page/page';
import { Loader } from '../../../../shared/components/loader/loader';
import { MessageList, Message } from '../../../../shared/components/message-list/message-list';
import { VideoConsultationComponent } from '../video-consultation/video-consultation';

import { Svg } from '../../../../shared/ui-components/svg/svg';
import { Button } from '../../../../shared/ui-components/button/button';
import { ButtonStyleEnum, ButtonSizeEnum, ButtonStateEnum } from '../../../../shared/constants/button';

interface ModalParticipant {
  name: string;
  email: string;
  contactType: 'email' | 'phone';
}

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
  ],
})
export class ConsultationDetail implements OnInit, OnDestroy {
  private destroy$ = new Subject<void>();
  private location = inject(Location);

  consultationId!: number;
  consultation = signal<Consultation | null>(null);
  appointments = signal<Appointment[]>([]);
  selectedAppointment = signal<Appointment | null>(null);
  participants = signal<Participant[]>([]);

  isLoadingConsultation = signal(false);
  isLoadingAppointments = signal(false);
  isLoadingParticipants = signal(false);
  isCreatingAppointment = signal(false);
  isAddingParticipant = signal(false);

  messages = signal<Message[]>([]);
  isWebSocketConnected = signal(false);
  currentUser = signal<IUser | null>(null);

  inCall = signal(false);
  activeAppointmentId = signal<number | null>(null);

  showCreateAppointmentModal = signal(false);
  showManageParticipantsModal = signal(false);
  modalParticipants = signal<ModalParticipant[]>([{ name: '', email: '', contactType: 'email' }]);

  appointmentForm: FormGroup;
  participantForm: FormGroup;

  protected readonly AppointmentStatus = AppointmentStatus;
  protected readonly ButtonStyleEnum = ButtonStyleEnum;
  protected readonly ButtonSizeEnum = ButtonSizeEnum;
  protected readonly ButtonStateEnum = ButtonStateEnum;

  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private fb = inject(FormBuilder);
  private consultationService = inject(ConsultationService);
  private confirmationService = inject(ConfirmationService);
  private toasterService = inject(ToasterService);
  private wsService = inject(ConsultationWebSocketService);
  private userService = inject(UserService);

  constructor() {
    this.appointmentForm = this.fb.group({
      type: ['Online', [Validators.required]],
      date: ['', [Validators.required]],
      time: ['', [Validators.required]],
      end_expected_at: [''],
    });

    this.participantForm = this.fb.group({
      email: ['', [Validators.email]],
      phone: [''],
      message_type: ['email', [Validators.required]],
    });
  }

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
    });

    this.setupWebSocketListeners();
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
      };
      this.messages.update(msgs => [...msgs, newMessage]);
    });

    this.wsService.participantJoined$.pipe(takeUntil(this.destroy$)).subscribe(event => {
      this.toasterService.show('success', 'Participant Joined', `${event.data.username} joined the consultation`);
      this.loadParticipants(this.selectedAppointment()!);
    });

    this.wsService.participantLeft$.pipe(takeUntil(this.destroy$)).subscribe(event => {
      this.toasterService.show('warning', 'Participant Left', `${event.data.username} left the consultation`);
      this.loadParticipants(this.selectedAppointment()!);
    });

    this.wsService.appointmentUpdated$.pipe(takeUntil(this.destroy$)).subscribe(() => {
      this.toasterService.show('success', 'Appointment Updated', 'An appointment has been updated');
      this.loadAppointments();
    });
  }

  onSendMessage(message: string): void {
    const user = this.currentUser();
    const tempId = Date.now();
    const newMessage: Message = {
      id: tempId,
      username: user?.first_name || user?.email || 'You',
      message: message,
      timestamp: new Date().toISOString(),
      isCurrentUser: true,
    };
    this.messages.update(msgs => [...msgs, newMessage]);

    this.consultationService
      .sendConsultationMessage(this.consultationId, { content: message })
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (savedMessage) => {
          this.messages.update(msgs =>
            msgs.map(m => m.id === tempId ? { ...m, id: savedMessage.id } : m)
          );
        },
        error: () => {
          this.toasterService.show('error', 'Error sending message');
          this.messages.update(msgs => msgs.filter(m => m.id !== tempId));
        },
      });
  }

  loadMessages(): void {
    this.consultationService
      .getConsultationMessages(this.consultationId)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: response => {
          const currentUserId = this.currentUser()?.pk;
          const loadedMessages: Message[] = response.results.map(msg => ({
            id: msg.id,
            username: msg.created_by === currentUserId ? 'You' : `User ${msg.created_by}`,
            message: msg.content || '',
            timestamp: msg.created_at,
            isCurrentUser: msg.created_by === currentUserId,
          }));
          this.messages.set(loadedMessages);
        },
        error: () => {
          this.toasterService.show('error', 'Error loading messages');
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
        error: error => {
          console.error('Error loading consultation:', error);
          this.isLoadingConsultation.set(false);
          this.toasterService.show('error', 'Error loading consultation');
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
        error: error => {
          console.error('Error loading appointments:', error);
          this.isLoadingAppointments.set(false);
          this.toasterService.show('error', 'Error loading appointments');
        },
      });
  }

  loadParticipants(appointment: Appointment): void {
    if (!appointment) return;

    this.isLoadingParticipants.set(true);
    this.consultationService
      .getAppointmentParticipants(appointment.id)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: response => {
          this.participants.set(response.results);
          this.isLoadingParticipants.set(false);
        },
        error: error => {
          console.error('Error loading participants:', error);
          this.isLoadingParticipants.set(false);
          this.toasterService.show('error', 'Error loading participants');
        },
      });
  }

  selectAppointment(appointment: Appointment): void {
    this.selectedAppointment.set(appointment);
    this.loadParticipants(appointment);
  }

  createAppointment(): void {
    if (this.appointmentForm.valid) {
      this.isCreatingAppointment.set(true);
      const formValue = this.appointmentForm.value;

      const scheduledAt = new Date(`${formValue.date}T${formValue.time}`).toISOString();

      const appointmentData: CreateAppointmentRequest = {
        type: formValue.type,
        scheduled_at: scheduledAt,
        end_expected_at: formValue.end_expected_at
          ? new Date(formValue.end_expected_at).toISOString()
          : undefined,
      };

      this.consultationService
        .createConsultationAppointment(this.consultationId, appointmentData)
        .pipe(takeUntil(this.destroy$))
        .subscribe({
          next: appointment => {
            const participants = this.modalParticipants().filter(p => p.email);
            if (participants.length > 0) {
              this.createParticipantsForAppointment(appointment.id, participants, appointment);
            } else {
              this.finalizeAppointmentCreation(appointment);
            }
          },
          error: error => {
            console.error('Error creating appointment:', error);
            this.isCreatingAppointment.set(false);
            this.toasterService.show('error', 'Error creating appointment');
          },
        });
    }
  }

  private createParticipantsForAppointment(appointmentId: number, participants: ModalParticipant[], appointment: Appointment): void {
    const requests = participants.map(p => {
      const data: any = {
        message_type: p.contactType === 'email' ? 'email' : 'sms',
      };
      if (p.contactType === 'email') {
        data.email = p.email;
      } else {
        data.phone = p.email;
      }
      return this.consultationService.addAppointmentParticipant(appointmentId, data).toPromise();
    });

    Promise.all(requests)
      .then(() => {
        this.loadAppointments();
        this.finalizeAppointmentCreation(appointment);
      })
      .catch(() => {
        this.finalizeAppointmentCreation(appointment);
        this.toasterService.show('warning', 'Appointment created but some participants could not be added');
      });
  }

  private finalizeAppointmentCreation(appointment: Appointment): void {
    const currentAppointments = this.appointments();
    this.appointments.set([...currentAppointments, appointment]);
    this.appointmentForm.reset({ type: 'Online' });
    this.modalParticipants.set([{ name: '', email: '', contactType: 'email' }]);
    this.isCreatingAppointment.set(false);
    this.showCreateAppointmentModal.set(false);
    this.toasterService.show('success', 'Appointment created successfully');
  }

  async cancelAppointment(appointment: Appointment): Promise<void> {
    const confirmed = await this.confirmationService.confirm({
      title: 'Cancel Appointment',
      message: 'Are you sure you want to cancel this appointment?',
      confirmText: 'Cancel Appointment',
      cancelText: 'Keep',
      confirmStyle: 'danger',
    });

    if (confirmed) {
      this.consultationService
        .cancelAppointment(appointment.id)
        .pipe(takeUntil(this.destroy$))
        .subscribe({
          next: updatedAppointment => {
            const currentAppointments = this.appointments();
            const updatedAppointments = currentAppointments.map(a =>
              a.id === appointment.id ? updatedAppointment : a
            );
            this.appointments.set(updatedAppointments);
            this.toasterService.show(
              'success',
              'Appointment cancelled successfully'
            );
          },
          error: () => {
            this.toasterService.show('error', 'Error cancelling appointment');
          },
        });
    }
  }

  async removeParticipant(participant: Participant): Promise<void> {
    if (!this.selectedAppointment()) return;

    const confirmed = await this.confirmationService.confirm({
      title: 'Remove Participant',
      message: 'Are you sure you want to remove this participant?',
      confirmText: 'Remove',
      cancelText: 'Cancel',
      confirmStyle: 'danger',
    });

    if (confirmed) {
      this.consultationService
        .removeAppointmentParticipant(
          this.selectedAppointment()!.id,
          participant.id
        )
        .pipe(takeUntil(this.destroy$))
        .subscribe({
          next: () => {
            const currentParticipants = this.participants();
            this.participants.set(
              currentParticipants.filter(p => p.id !== participant.id)
            );
            this.toasterService.show(
              'success',
              'Participant removed successfully'
            );
          },
          error: () => {
            this.toasterService.show('error', 'Error removing participant');
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
            this.toasterService.show(
              'success',
              'Consultation closed successfully'
            );
          },
          error: () => {
            this.toasterService.show('error', 'Error closing consultation');
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
            this.toasterService.show(
              'success',
              'Consultation reopened successfully'
            );
          },
          error: () => {
            this.toasterService.show('error', 'Error reopening consultation');
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
    this.appointmentForm.reset({ type: 'Online' });
    this.modalParticipants.set([{ name: '', email: '', contactType: 'email' }]);
    this.showCreateAppointmentModal.set(true);
  }

  closeCreateAppointmentModal(): void {
    this.showCreateAppointmentModal.set(false);
  }

  openManageParticipantsModal(appointment: Appointment): void {
    this.selectedAppointment.set(appointment);
    this.loadParticipants(appointment);
    this.participantForm.reset({ message_type: 'email' });
    this.showManageParticipantsModal.set(true);
  }

  closeManageParticipantsModal(): void {
    this.showManageParticipantsModal.set(false);
    this.loadAppointments();
  }

  setAppointmentType(type: string): void {
    this.appointmentForm.patchValue({ type });
  }

  setParticipantMessageType(type: string): void {
    this.participantForm.patchValue({ message_type: type });
  }

  addModalParticipant(): void {
    this.modalParticipants.update(list => [...list, { name: '', email: '', contactType: 'email' }]);
  }

  removeModalParticipant(index: number): void {
    this.modalParticipants.update(list => list.filter((_, i) => i !== index));
  }

  updateModalParticipant(index: number, field: string, event: any): void {
    const value = typeof event === 'string' ? event : event.target.value;
    this.modalParticipants.update(list => {
      const updated = [...list];
      updated[index] = { ...updated[index], [field]: value };
      return updated;
    });
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

  addParticipantToAppointment(): void {
    const appointment = this.selectedAppointment();
    if (!appointment) return;

    const formValue = this.participantForm.value;
    const data: any = {
      message_type: formValue.message_type,
    };

    if (formValue.message_type === 'email' && formValue.email) {
      data.email = formValue.email;
    } else if (formValue.message_type === 'sms' && formValue.phone) {
      data.phone = formValue.phone;
    } else {
      this.toasterService.show('error', 'Please provide contact information');
      return;
    }

    this.isAddingParticipant.set(true);
    this.consultationService
      .addAppointmentParticipant(appointment.id, data)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: () => {
          this.loadParticipants(appointment);
          this.participantForm.reset({ message_type: 'email' });
          this.isAddingParticipant.set(false);
          this.toasterService.show('success', 'Participant added successfully');
        },
        error: () => {
          this.isAddingParticipant.set(false);
          this.toasterService.show('error', 'Error adding participant');
        },
      });
  }
}
