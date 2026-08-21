import {
  Component,
  OnInit,
  OnDestroy,
  signal,
  computed,
  inject,
  viewChild,
} from '@angular/core';
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
import { BadgeTypeEnum, BadgeSizeEnum } from '../../../../shared/constants/badge';
import {
  DataTable,
  DataTableColumn,
} from '../../../../shared/components/data-table/data-table';
import { DataTableCellDirective } from '../../../../shared/components/data-table/data-table-cell.directive';
import { ReminderCard } from '../../../../shared/components/reminder-card/reminder-card';
import { ReminderFormModal } from '../../../../shared/components/reminder-form-modal/reminder-form-modal';
import { AppointmentFormModal } from '../consultation-detail/appointment-form-modal/appointment-form-modal';
import { AppointmentPanel } from '../../../../shared/components/appointment-panel/appointment-panel';
import { UserService } from '../../../../core/services/user.service';
import { ConfirmationService } from '../../../../core/services/confirmation.service';
import { Reminder } from '../../../../core/models/reminder';
import {
  formatConsultationId,
  formatUserName,
  getConsultationBadgeType,
  getAppointmentBadgeType,
} from '../../../../shared/tools/helper';
import { getErrorMessage } from '../../../../core/utils/error-helper';
import { LocalDatePipe } from '../../../../shared/pipes/local-date.pipe';

/** One cell of the personal-information grid. */
interface PatientInfoField {
  label: string;
  value: string;
  /** True when the value is a fallback label, so it renders muted. */
  empty: boolean;
  badge?: string;
}

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
    DataTable,
    DataTableCellDirective,
    ReminderCard,
    ReminderFormModal,
    AppointmentFormModal,
    AppointmentPanel,
    UserAvatar,
    LocalDatePipe,
  ],
  templateUrl: './patient-detail.html',
  styleUrl: './patient-detail.scss',
  providers: [LocalDatePipe],
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
  private userService = inject(UserService);
  private localDate = inject(LocalDatePipe);

  protected readonly TypographyTypeEnum = TypographyTypeEnum;
  protected readonly ButtonSizeEnum = ButtonSizeEnum;
  protected readonly ButtonStyleEnum = ButtonStyleEnum;
  protected readonly ButtonStateEnum = ButtonStateEnum;
  protected readonly AppointmentStatus = AppointmentStatus;
  protected readonly getConsultationBadgeType = getConsultationBadgeType;
  protected readonly getAppointmentBadgeType = getAppointmentBadgeType;
  protected readonly BadgeTypeEnum = BadgeTypeEnum;
  protected readonly BadgeSizeEnum = BadgeSizeEnum;

  patientId: number | null = null;
  appointmentPanel = viewChild(AppointmentPanel);
  /** Signed-in practitioner, so participant cards can label themselves "Me". */
  currentUser = signal<IUser | null>(null);
  activeTab = signal<
    'overview' | 'consultations' | 'appointments' | 'reminders'
  >('overview');
  showEditModal = signal(false);
  loading = signal(true);
  loadingConsultations = signal(false);
  loadingReminders = signal(false);

  patient = signal<IUser | null>(null);
  healthMetrics = signal<IHealthMetric[]>([]);
  consultations = signal<Consultation[]>([]);

  // Totals reported by the API, so the tab pills stay right past the first page.
  consultationsCount = signal(0);
  appointmentsCount = signal(0);
  remindersCount = signal(0);

  protected readonly formatConsultationId = formatConsultationId;
  protected readonly formatUserName = formatUserName;

  consultationColumns = computed<DataTableColumn[]>(() => {
    // Read the language so headers are rebuilt when the user switches locale.
    this.t.currentLanguage();
    return [
      {
        key: 'title',
        label: this.t.instant('consultations.columnFollowUp'),
        width: 'minmax(220px, 2.2fr)',
      },
      {
        key: 'practitioner',
        label: this.t.instant('consultationRowItem.practitioner'),
        width: 'minmax(130px, 1.2fr)',
      },
      {
        key: 'status',
        label: this.t.instant('consultationRowItem.status'),
        width: 'minmax(100px, 0.8fr)',
      },
      {
        key: 'created',
        label: this.t.instant('consultations.columnCreatedAt'),
        width: 'minmax(150px, 1.1fr)',
      },
      {
        key: 'closed',
        label: this.t.instant('consultationRowItem.closed'),
        width: 'minmax(150px, 1.1fr)',
      },
      { key: 'chevron', width: '24px', align: 'end', hideOnMobile: true },
    ];
  });

  readonly consultationAccent = (consultation: Consultation): string =>
    consultation.closed_at ? 'var(--slate-300)' : 'var(--emerald-500)';

  readonly trackConsultation = (consultation: Consultation): number =>
    consultation.id;

  /** The attribute grid of the overview tab, empty values included. */
  personalFields = computed<PatientInfoField[]>(() => {
    const patient = this.patient();
    if (!patient) return [];
    // Read the language so labels are rebuilt when the user switches locale.
    this.t.currentLanguage();

    const notProvided = this.t.instant('patientDetail.notProvided');
    const fields: PatientInfoField[] = [];
    const push = (labelKey: string, value: string, badge?: string): void => {
      fields.push({
        label: this.t.instant(labelKey),
        value: value || notProvided,
        empty: !value,
        badge,
      });
    };

    push('patientDetail.emailLabel', patient.email);
    if (patient.mobile_phone_number) {
      push('patientDetail.phoneLabel', patient.mobile_phone_number);
    }
    if (patient.street || patient.city) {
      push('patientDetail.address', this.formatAddress(patient));
    }
    push(
      'patientDetail.communicationMethod',
      this.getCommunicationMethodLabel(patient.communication_method),
      this.t.instant('patientDetail.defaultChannel')
    );
    push('patientDetail.language', this.getLanguageName(patient));
    push('patientDetail.timezone', patient.timezone);
    if (patient.main_organisation) {
      push('patientDetail.organisation', patient.main_organisation.name);
    }

    const lastLogin = patient.last_login
      ? this.localDate.transform(patient.last_login, 'medium')
      : '';
    fields.push({
      label: this.t.instant('patientDetail.lastLogin'),
      value: lastLogin || this.t.instant('patientDetail.never'),
      empty: !lastLogin,
    });

    return fields;
  });

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
        count: this.consultationsCount(),
      },
      {
        id: 'appointments',
        label: this.t.instant('patientDetail.tabAppointments'),
        count: this.appointmentsCount(),
      },
      {
        id: 'reminders',
        label: this.t.instant('patientDetail.tabReminders'),
        count: this.remindersCount(),
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

    this.userService.currentUser$
      .pipe(takeUntil(this.destroy$))
      .subscribe(user => this.currentUser.set(user));

    this.route.params.pipe(takeUntil(this.destroy$)).subscribe(params => {
      if (params['id']) {
        this.patientId = +params['id'];
        this.loadPatient();
        this.loadConsultations();
        this.loadAppointmentsCount();
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
          this.consultationsCount.set(response.count);
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


  /**
   * The appointments tab pill needs the total before its panel is mounted, so
   * it is fetched here rather than read from the panel.
   */
  loadAppointmentsCount(): void {
    if (!this.patientId) return;

    this.consultationService
      .getAppointments({
        consultation__beneficiary: this.patientId,
        page_size: 1,
      })
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: response => this.appointmentsCount.set(response.count),
        error: () => {
          // A badge is not worth a toaster: keep the previous count.
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
    this.appointmentPanel()?.reload();
    this.loadAppointmentsCount();
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
          this.remindersCount.set(response.count);
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
          this.remindersCount.set(this.reminders().length);
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
    this.activeTab.set(
      tab as 'overview' | 'consultations' | 'appointments' | 'reminders'
    );
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
        return method || '';
    }
  }

  /** Street, postal code, city and country joined as one readable line. */
  private formatAddress(patient: IUser): string {
    const locality = [patient.postal_code, patient.city]
      .filter(part => !!part)
      .join(' ');
    const address = [patient.street, locality]
      .filter(part => !!part)
      .join(', ');
    return patient.country ? `${address} - ${patient.country}` : address;
  }

  getLanguageName(patient: IUser): string {
    if (patient.languages && patient.languages.length > 0) {
      return patient.languages.map(l => l.name).join(', ');
    }
    return '';
  }


  canEditPatient(): boolean {
    const patient = this.patient();
    if (!patient) return false;

    // Don't allow editing if the patient is a practitioner
    return !patient.is_practitioner;
  }
}
