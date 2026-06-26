import { Component, OnInit, OnDestroy, signal, inject } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { CommonModule } from '@angular/common';
import { Subject, takeUntil, forkJoin } from 'rxjs';
import { TranslatePipe } from '@ngx-translate/core';
import { Page } from '../../../../core/components/page/page';
import { Svg } from '../../../../shared/ui-components/svg/svg';
import { Typography } from '../../../../shared/ui-components/typography/typography';
import { Button } from '../../../../shared/ui-components/button/button';
import { Loader } from '../../../../shared/components/loader/loader';
import { Tabs, TabItem } from '../../../../shared/components/tabs/tabs';
import { ModalComponent } from '../../../../shared/components/modal/modal.component';
import { AddEditPatient } from '../add-edit-patient/add-edit-patient';
import { UserAvatar } from '../../../../shared/components/user-avatar/user-avatar';
import { TypographyTypeEnum } from '../../../../shared/constants/typography';
import {
  ButtonSizeEnum,
  ButtonStyleEnum,
  ButtonStateEnum,
} from '../../../../shared/constants/button';
import { IHealthMetric, IHealthMetricResponse } from '../../models/patient';
import { IUser } from '../../models/user';
import { RoutePaths } from '../../../../core/constants/routes';
import { PatientService } from '../../../../core/services/patient.service';
import { ConsultationService } from '../../../../core/services/consultation.service';
import {
  Consultation,
  Appointment,
  AppointmentStatus,
  CustomFieldValue,
  CreateParticipantRequest,
} from '../../../../core/models/consultation';
import { ToasterService } from '../../../../core/services/toaster.service';
import { TranslationService } from '../../../../core/services/translation.service';
import { Badge } from '../../../../shared/components/badge/badge';
import { BadgeTypeEnum } from '../../../../shared/constants/badge';
import { ConsultationRowItem } from '../../../../shared/components/consultation-row-item/consultation-row-item';
import { ReminderCard } from '../../../../shared/components/reminder-card/reminder-card';
import { ReminderFormModal } from '../../../../shared/components/reminder-form-modal/reminder-form-modal';
import { AppointmentFormModal } from '../consultation-detail/appointment-form-modal/appointment-form-modal';
import { ConfirmationService } from '../../../../core/services/confirmation.service';
import { Reminder } from '../../../../core/models/reminder';
import {
  getConsultationBadgeType,
  getAppointmentBadgeType,
} from '../../../../shared/tools/helper';
import { getErrorMessage } from '../../../../core/utils/error-helper';
import { LocalDatePipe } from '../../../../shared/pipes/local-date.pipe';

@Component({
  selector: 'app-patient-detail',
  imports: [
    CommonModule,
    TranslatePipe,
    Page,
    Svg,
    Typography,
    Button,
    Loader,
    Tabs,
    ModalComponent,
    AddEditPatient,
    Badge,
    ConsultationRowItem,
    ReminderCard,
    ReminderFormModal,
    AppointmentFormModal,
    UserAvatar,
    LocalDatePipe,
  ],
  templateUrl: './patient-detail.html',
  styleUrl: './patient-detail.scss',
})
export class PatientDetail implements OnInit, OnDestroy {
  private destroy$ = new Subject<void>();
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private patientService = inject(PatientService);
  private consultationService = inject(ConsultationService);
  private toasterService = inject(ToasterService);
  private confirmationService = inject(ConfirmationService);
  private t = inject(TranslationService);

  protected readonly TypographyTypeEnum = TypographyTypeEnum;
  protected readonly ButtonSizeEnum = ButtonSizeEnum;
  protected readonly ButtonStyleEnum = ButtonStyleEnum;
  protected readonly ButtonStateEnum = ButtonStateEnum;
  protected readonly AppointmentStatus = AppointmentStatus;
  protected readonly getConsultationBadgeType = getConsultationBadgeType;
  protected readonly getAppointmentBadgeType = getAppointmentBadgeType;
  protected readonly BadgeTypeEnum = BadgeTypeEnum;

  patientId: number | null = null;
  activeTab = signal<
    'overview' | 'consultations' | 'appointments' | 'reminders'
  >('overview');
  showEditModal = signal(false);
  loading = signal(true);
  loadingConsultations = signal(false);
  loadingAppointments = signal(false);
  loadingReminders = signal(false);

  patient = signal<IUser | null>(null);
  healthMetrics = signal<IHealthMetric[]>([]);
  consultations = signal<Consultation[]>([]);
  appointments = signal<Appointment[]>([]);
  reminders = signal<Reminder[]>([]);

  showReminderModal = signal(false);
  editingReminder = signal<Reminder | null>(null);

  showAppointmentModal = signal(false);
  editingAppointment = signal<Appointment | null>(null);

  get tabItems(): TabItem[] {
    return [
      { id: 'overview', label: this.t.instant('patientDetail.tabOverview') },
      {
        id: 'consultations',
        label: this.t.instant('patientDetail.tabConsultations'),
      },
      {
        id: 'appointments',
        label: this.t.instant('patientDetail.tabAppointments'),
      },
      {
        id: 'reminders',
        label: this.t.instant('patientDetail.tabReminders'),
      },
    ];
  }

  ngOnInit(): void {
    this.route.fragment.pipe(takeUntil(this.destroy$)).subscribe(fragment => {
      if (
        fragment === 'overview' ||
        fragment === 'consultations' ||
        fragment === 'appointments' ||
        fragment === 'reminders'
      ) {
        this.activeTab.set(fragment);
      }
    });

    this.route.params.pipe(takeUntil(this.destroy$)).subscribe(params => {
      if (params['id']) {
        this.patientId = +params['id'];
        this.loadPatient();
        this.loadConsultations();
        this.loadAppointments();
        this.loadReminders();
      }
    });
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  loadPatient(): void {
    if (!this.patientId) return;

    this.loading.set(true);
    forkJoin({
      patient: this.patientService.getPatient(this.patientId),
    })
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: ({ patient }) => {
          this.patient.set(patient);
          // this.healthMetrics.set(this.transformHealthMetrics(healthMetrics.results));
          this.loading.set(false);
        },
        error: err => {
          this.toasterService.show(
            'error',
            this.t.instant('patientDetail.errorLoadingPatient'),
            getErrorMessage(err)
          );
          this.loading.set(false);
        },
      });
  }

  loadConsultations(): void {
    if (!this.patientId) return;

    this.loadingConsultations.set(true);
    this.consultationService
      .getConsultations({ beneficiary: this.patientId })
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: response => {
          this.consultations.set(response.results);
          this.loadingConsultations.set(false);
        },
        error: err => {
          this.toasterService.show(
            'error',
            this.t.instant('patientDetail.errorLoadingConsultations'),
            getErrorMessage(err)
          );
          this.loadingConsultations.set(false);
        },
      });
  }

  loadAppointments(): void {
    if (!this.patientId) return;

    this.loadingAppointments.set(true);
    this.consultationService
      .getAppointments({ consultation__beneficiary: this.patientId })
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: response => {
          this.appointments.set(response.results);
          this.loadingAppointments.set(false);
        },
        error: err => {
          this.toasterService.show(
            'error',
            this.t.instant('patientDetail.errorLoadingAppointments'),
            getErrorMessage(err)
          );
          this.loadingAppointments.set(false);
        },
      });
  }

  // When creating an appointment from the contact page, pre-add the contact
  // as a participant.
  get patientAsParticipant(): CreateParticipantRequest[] {
    const p = this.patient();
    if (!p) return [];
    return [
      {
        user_id: p.pk,
        first_name: p.first_name,
        last_name: p.last_name,
        email: p.email,
      },
    ];
  }

  openCreateAppointmentModal(): void {
    this.editingAppointment.set(null);
    this.showAppointmentModal.set(true);
  }

  openEditAppointmentModal(appointment: Appointment): void {
    this.editingAppointment.set(appointment);
    this.showAppointmentModal.set(true);
  }

  closeAppointmentModal(): void {
    this.showAppointmentModal.set(false);
    this.editingAppointment.set(null);
  }

  onAppointmentSaved(): void {
    this.showAppointmentModal.set(false);
    this.editingAppointment.set(null);
    this.loadAppointments();
  }

  async deleteAppointment(appointment: Appointment): Promise<void> {
    const confirmed = await this.confirmationService.confirm({
      title: this.t.instant('patientDetail.deleteAppointmentTitle'),
      message: this.t.instant('patientDetail.deleteAppointmentMessage'),
      confirmText: this.t.instant('reminders.delete'),
      cancelText: this.t.instant('reminders.cancel'),
      confirmStyle: 'danger',
    });

    if (!confirmed) return;

    this.consultationService
      .deleteAppointment(appointment.id)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: () => {
          this.appointments.set(
            this.appointments().filter(a => a.id !== appointment.id)
          );
          this.toasterService.show(
            'success',
            this.t.instant('patientDetail.appointmentDeleted')
          );
        },
        error: error => {
          this.toasterService.show(
            'error',
            this.t.instant('patientDetail.errorDeletingAppointment'),
            getErrorMessage(error)
          );
        },
      });
  }

  loadReminders(): void {
    if (!this.patientId) return;

    this.loadingReminders.set(true);
    this.consultationService
      .getReminders({
        recipient: this.patientId,
        ordering: 'scheduled_at',
        page_size: 100,
      })
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: response => {
          this.reminders.set(response.results);
          this.loadingReminders.set(false);
        },
        error: err => {
          this.toasterService.show(
            'error',
            this.t.instant('reminders.errorLoading'),
            getErrorMessage(err)
          );
          this.loadingReminders.set(false);
        },
      });
  }

  openCreateReminderModal(): void {
    this.editingReminder.set(null);
    this.showReminderModal.set(true);
  }

  openEditReminderModal(reminder: Reminder): void {
    this.editingReminder.set(reminder);
    this.showReminderModal.set(true);
  }

  closeReminderModal(): void {
    this.showReminderModal.set(false);
    this.editingReminder.set(null);
  }

  onReminderSaved(): void {
    this.showReminderModal.set(false);
    this.editingReminder.set(null);
    this.loadReminders();
  }

  async deleteReminder(reminder: Reminder): Promise<void> {
    const confirmed = await this.confirmationService.confirm({
      title: this.t.instant('reminders.deleteTitle'),
      message: this.t.instant('reminders.deleteMessage'),
      confirmText: this.t.instant('reminders.delete'),
      cancelText: this.t.instant('reminders.cancel'),
      confirmStyle: 'danger',
    });

    if (!confirmed) return;

    this.consultationService
      .deleteReminder(reminder.id)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: () => {
          this.reminders.set(
            this.reminders().filter(r => r.id !== reminder.id)
          );
          this.toasterService.show(
            'success',
            this.t.instant('reminders.deleted')
          );
        },
        error: error => {
          this.toasterService.show(
            'error',
            this.t.instant('reminders.errorDeleting'),
            getErrorMessage(error)
          );
        },
      });
  }

  getInitials(patient: IUser): string {
    const first = patient.first_name?.charAt(0) || '';
    const last = patient.last_name?.charAt(0) || '';
    return (first + last).toUpperCase() || 'U';
  }

  getFullName(patient: IUser): string {
    return (
      `${patient.first_name || ''} ${patient.last_name || ''}`.trim() ||
      patient.email
    );
  }

  setActiveTab(tab: string): void {
    this.activeTab.set(tab as 'overview' | 'consultations' | 'appointments');
    this.router.navigate([], { fragment: tab, replaceUrl: true });
  }

  goBack(): void {
    this.router.navigate([RoutePaths.USER, 'patients']);
  }

  startConsultation(): void {
    this.router.navigate([RoutePaths.USER, 'consultations', 'new']);
  }

  viewConsultation(consultation: Consultation): void {
    this.router.navigate([RoutePaths.USER, 'consultations', consultation.id]);
  }

  getAppointmentType(type: string): string {
    const appointmentType = type?.toLowerCase();
    switch (appointmentType) {
      case 'online':
        return this.t.instant('patientDetail.videoCall');
      case 'inperson':
        return this.t.instant('patientDetail.inPerson');
      case 'in_person':
        return this.t.instant('patientDetail.inPerson');
      case 'phone':
        return this.t.instant('patientDetail.phoneCall');
      default:
        return type;
    }
  }

  openEditModal(): void {
    this.showEditModal.set(true);
  }

  closeEditModal(): void {
    this.showEditModal.set(false);
  }

  onPatientSaved(): void {
    this.closeEditModal();
    this.loadPatient();
  }

  getTrendClass(trend: string): string {
    switch (trend) {
      case 'up':
        return 'trend-up';
      case 'down':
        return 'trend-down';
      default:
        return 'trend-stable';
    }
  }

  getMetricColorClass(color: string): string {
    return `metric-${color}`;
  }

  getCommunicationMethodLabel(method: string): string {
    switch (method) {
      case 'sms':
        return 'SMS';
      case 'email':
        return 'Email';
      case 'whatsapp':
        return 'WhatsApp';
      case 'push':
        return this.t.instant('patientDetail.pushNotification');
      case 'manual':
        return this.t.instant('patientDetail.manualContact');
      default:
        return method || '-';
    }
  }

  getLanguageName(patient: IUser): string {
    if (patient.languages && patient.languages.length > 0) {
      return patient.languages.map(l => l.name).join(', ');
    }
    return '-';
  }

  getAppointmentStatusLabel(status: string): string {
    switch (status?.toLowerCase()) {
      case 'scheduled':
        return this.t.instant('patientDetail.statusScheduled');
      case 'cancelled':
        return this.t.instant('patientDetail.statusCancelled');
      case 'completed':
        return this.t.instant('patientDetail.statusCompleted');
      case 'draft':
        return this.t.instant('patientDetail.statusDraft');
      case 'in_progress':
        return this.t.instant('patientDetail.statusInProgress');
      default:
        return status;
    }
  }

  canEditPatient(): boolean {
    const patient = this.patient();
    if (!patient) return false;

    // Don't allow editing if the patient is a practitioner
    return !patient.is_practitioner;
  }
}
