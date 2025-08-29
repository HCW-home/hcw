import { Component, OnInit, OnDestroy, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { FormBuilder, FormGroup, Validators, ReactiveFormsModule } from '@angular/forms';
import { CommonModule } from '@angular/common';
import { Subject, takeUntil } from 'rxjs';

// Core services and models
import { ConsultationService } from '../../../../core/services/consultation.service';
import { ToasterService } from '../../../../core/services/toaster.service';
import {
  Consultation,
  Appointment,
  Participant,
  AppointmentStatus,
  CreateAppointmentRequest,
  CreateParticipantRequest
} from '../../../../core/models/consultation';

// Shared components
import { Page } from '../../../../core/components/page/page';
import { BackButton } from '../../../../shared/components/back-button/back-button';
import { Tabs, TabItem } from '../../../../shared/components/tabs/tabs';
import { Badge } from '../../../../shared/components/badge/badge';
import { Loader } from '../../../../shared/components/loader/loader';

// UI Components
import { Typography } from '../../../../shared/ui-components/typography/typography';
import { Button } from '../../../../shared/ui-components/button/button';
import { Input } from '../../../../shared/ui-components/input/input';
import { Select } from '../../../../shared/ui-components/select/select';
import { Svg } from '../../../../shared/ui-components/svg/svg';

// Constants
import { TypographyTypeEnum } from '../../../../shared/constants/typography';
import {ButtonSizeEnum, ButtonStyleEnum, ButtonTypeEnum} from '../../../../shared/constants/button';
import { BadgeTypeEnum } from '../../../../shared/constants/badge';
import { SelectOption } from '../../../../shared/models/select';

@Component({
  selector: 'app-consultation-detail',
  templateUrl: './consultation-detail.html',
  styleUrl: './consultation-detail.scss',
  imports: [
    CommonModule,
    ReactiveFormsModule,
    Page,
    BackButton,
    Tabs,
    Badge,
    Loader,
    Typography,
    Button,
    Input,
    Select,
    Svg
  ]
})
export class ConsultationDetail implements OnInit, OnDestroy {
  private destroy$ = new Subject<void>();

  consultationId!: number;
  consultation = signal<Consultation | null>(null);
  appointments = signal<Appointment[]>([]);
  selectedAppointment = signal<Appointment | null>(null);
  participants = signal<Participant[]>([]);

  isLoadingConsultation = signal(false);
  isLoadingAppointments = signal(false);
  isLoadingParticipants = signal(false);

  activeTab = signal<'appointments' | 'participants'>('appointments');

  appointmentForm: FormGroup;
  participantForm: FormGroup;

  protected readonly TypographyTypeEnum = TypographyTypeEnum;
  protected readonly ButtonSizeEnum = ButtonSizeEnum;
  protected readonly ButtonStyleEnum = ButtonStyleEnum;
  protected readonly BadgeTypeEnum = BadgeTypeEnum;
  protected readonly AppointmentStatus = AppointmentStatus;

  communicationMethods: SelectOption[] = [
    { value: 'email', label: 'Email' },
    { value: 'sms', label: 'SMS' },
    { value: 'whatsapp', label: 'WhatsApp' }
  ];

  constructor(
    private route: ActivatedRoute,
    private router: Router,
    private fb: FormBuilder,
    private consultationService: ConsultationService,
    private toasterService: ToasterService
  ) {
    this.appointmentForm = this.fb.group({
      scheduled_at: ['', [Validators.required]],
      end_expected_at: ['']
    });

    this.participantForm = this.fb.group({
      email: ['', [Validators.email]],
      phone: [''],
      message_type: ['email', [Validators.required]]
    });
  }

  ngOnInit(): void {
    this.route.params.pipe(takeUntil(this.destroy$)).subscribe(params => {
      this.consultationId = +params['id'];
      this.loadConsultation();
      this.loadAppointments();
    });
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  get tabItems(): TabItem[] {
    return [
      {
        id: 'appointments',
        label: 'Appointments',
        count: this.appointments().length,
      },
      {
        id: 'participants',
        label: 'Participants',
        count: this.participants().length,
      },
    ];
  }

  setActiveTab(tab: string): void {
    this.activeTab.set(tab as 'appointments' | 'participants');
  }

  loadConsultation(): void {
    this.isLoadingConsultation.set(true);
    this.consultationService.getConsultation(this.consultationId)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (consultation) => {
          this.consultation.set(consultation);
          this.isLoadingConsultation.set(false);
        },
        error: (error) => {
          console.error('Error loading consultation:', error);
          this.isLoadingConsultation.set(false);
          this.toasterService.show('error', 'Error loading consultation');
        }
      });
  }

  loadAppointments(): void {
    this.isLoadingAppointments.set(true);
    this.consultationService.getConsultationAppointments(this.consultationId)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (response) => {
          this.appointments.set(response.results);
          this.isLoadingAppointments.set(false);
        },
        error: (error) => {
          console.error('Error loading appointments:', error);
          this.isLoadingAppointments.set(false);
          this.toasterService.show('error', 'Error loading appointments');
        }
      });
  }

  loadParticipants(appointment: Appointment): void {
    if (!appointment) return;

    this.isLoadingParticipants.set(true);
    this.consultationService.getAppointmentParticipants(this.consultationId, appointment.id)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (response) => {
          this.participants.set(response.results);
          this.isLoadingParticipants.set(false);
        },
        error: (error) => {
          console.error('Error loading participants:', error);
          this.isLoadingParticipants.set(false);
          this.toasterService.show('error', 'Error loading participants');
        }
      });
  }

  selectAppointment(appointment: Appointment): void {
    this.selectedAppointment.set(appointment);
    this.loadParticipants(appointment);
    this.setActiveTab('participants');
  }

  createAppointment(): void {
    if (this.appointmentForm.valid) {
      const formValue = this.appointmentForm.value;
      const appointmentData: CreateAppointmentRequest = {
        scheduled_at: new Date(formValue.scheduled_at).toISOString(),
        end_expected_at: formValue.end_expected_at ? new Date(formValue.end_expected_at).toISOString() : undefined
      };

      this.consultationService.createConsultationAppointment(this.consultationId, appointmentData)
        .pipe(takeUntil(this.destroy$))
        .subscribe({
          next: (appointment) => {
            const currentAppointments = this.appointments();
            this.appointments.set([...currentAppointments, appointment]);
            this.appointmentForm.reset();
            this.toasterService.show('success', 'Appointment created successfully');
          },
          error: (error) => {
            console.error('Error creating appointment:', error);
            this.toasterService.show('error', 'Error creating appointment');
          }
        });
    }
  }

  cancelAppointment(appointment: Appointment): void {
    if (confirm('Are you sure you want to cancel this appointment?')) {
      this.consultationService.cancelAppointment(this.consultationId, appointment.id)
        .pipe(takeUntil(this.destroy$))
        .subscribe({
          next: (updatedAppointment) => {
            const currentAppointments = this.appointments();
            const updatedAppointments = currentAppointments.map(a =>
              a.id === appointment.id ? updatedAppointment : a
            );
            this.appointments.set(updatedAppointments);
            this.toasterService.show('success', 'Appointment cancelled successfully');
          },
          error: (error) => {
            console.error('Error cancelling appointment:', error);
            this.toasterService.show('error', 'Error cancelling appointment');
          }
        });
    }
  }

  addParticipant(): void {
    if (this.participantForm.valid && this.selectedAppointment()) {
      const participantData: CreateParticipantRequest = {
        email: this.participantForm.value.email || undefined,
        phone: this.participantForm.value.phone || undefined,
        message_type: this.participantForm.value.message_type
      };

      this.consultationService.addAppointmentParticipant(
        this.consultationId,
        this.selectedAppointment()!.id,
        participantData
      )
        .pipe(takeUntil(this.destroy$))
        .subscribe({
          next: (participant) => {
            const currentParticipants = this.participants();
            this.participants.set([...currentParticipants, participant]);
            this.participantForm.reset();
            this.participantForm.patchValue({ message_type: 'email' });
            this.toasterService.show('success', 'Participant added successfully');
          },
          error: (error) => {
            console.error('Error adding participant:', error);
            this.toasterService.show('error', 'Error adding participant');
          }
        });
    }
  }

  removeParticipant(participant: Participant): void {
    if (this.selectedAppointment() && confirm('Are you sure you want to remove this participant?')) {
      this.consultationService.removeAppointmentParticipant(
        this.consultationId,
        this.selectedAppointment()!.id,
        participant.id
      )
        .pipe(takeUntil(this.destroy$))
        .subscribe({
          next: () => {
            const currentParticipants = this.participants();
            this.participants.set(currentParticipants.filter(p => p.id !== participant.id));
            this.toasterService.show('success', 'Participant removed successfully');
          },
          error: (error) => {
            console.error('Error removing participant:', error);
            this.toasterService.show('error', 'Error removing participant');
          }
        });
    }
  }

  closeConsultation(): void {
    if (this.consultation() && confirm('Are you sure you want to close this consultation?')) {
      this.consultationService.closeConsultation(this.consultationId)
        .pipe(takeUntil(this.destroy$))
        .subscribe({
          next: (updatedConsultation) => {
            this.consultation.set(updatedConsultation);
            this.toasterService.show('success', 'Consultation closed successfully');
          },
          error: (error) => {
            console.error('Error closing consultation:', error);
            this.toasterService.show('error', 'Error closing consultation');
          }
        });
    }
  }

  reopenConsultation(): void {
    if (this.consultation() && confirm('Are you sure you want to reopen this consultation?')) {
      this.consultationService.reopenConsultation(this.consultationId)
        .pipe(takeUntil(this.destroy$))
        .subscribe({
          next: (updatedConsultation) => {
            this.consultation.set(updatedConsultation);
            this.toasterService.show('success', 'Consultation reopened successfully');
          },
          error: (error) => {
            console.error('Error reopening consultation:', error);
            this.toasterService.show('error', 'Error reopening consultation');
          }
        });
    }
  }

  formatDateTime(dateString: string): string {
    return new Date(dateString).toLocaleString();
  }

  getUserDisplayName(participant: Participant): string {
    if (participant.user) {
      return `${participant.user.first_name} ${participant.user.last_name}`.trim() || participant.user.email;
    }
    return participant.email || 'Unknown';
  }

  getAppointmentStatusBadgeType(status: AppointmentStatus): BadgeTypeEnum {
    switch (status) {
      case AppointmentStatus.SCHEDULED:
        return BadgeTypeEnum.green;
      case AppointmentStatus.CANCELLED:
        return BadgeTypeEnum.red;
      default:
        return BadgeTypeEnum.blue;
    }
  }

  getParticipantStatusBadgeType(isConfirmed: boolean): BadgeTypeEnum {
    return isConfirmed ? BadgeTypeEnum.green : BadgeTypeEnum.orange;
  }

  protected readonly ButtonTypeEnum = ButtonTypeEnum;
}
