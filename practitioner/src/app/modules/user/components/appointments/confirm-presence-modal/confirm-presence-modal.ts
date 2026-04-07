import {
  Component,
  Input,
  Output,
  EventEmitter,
  inject,
  signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { Subject, takeUntil } from 'rxjs';
import { TranslatePipe } from '@ngx-translate/core';
import { ModalComponent } from '../../../../../shared/components/modal/modal.component';
import { Button } from '../../../../../shared/ui-components/button/button';
import { Svg } from '../../../../../shared/ui-components/svg/svg';
import { ConsultationService } from '../../../../../core/services/consultation.service';
import { Auth } from '../../../../../core/services/auth';
import { ToasterService } from '../../../../../core/services/toaster.service';
import { TranslationService } from '../../../../../core/services/translation.service';
import {
  Appointment,
  AppointmentStatus,
  AppointmentType,
  Participant,
  ParticipantStatus,
} from '../../../../../core/models/consultation';
import {
  ButtonStyleEnum,
  ButtonStateEnum,
  ButtonSizeEnum,
} from '../../../../../shared/constants/button';
import { LocalDatePipe } from '../../../../../shared/pipes/local-date.pipe';
import { ConfirmationService } from '../../../../../core/services/confirmation.service';
import { ActiveCallService } from '../../../../../core/services/active-call.service';
import { IncomingCallService } from '../../../../../core/services/incoming-call.service';
import { RoutePaths } from '../../../../../core/constants/routes';

@Component({
  selector: 'app-confirm-presence-modal',
  templateUrl: './confirm-presence-modal.html',
  styleUrl: './confirm-presence-modal.scss',
  imports: [
    CommonModule,
    ModalComponent,
    Button,
    Svg,
    LocalDatePipe,
    TranslatePipe,
  ],
})
export class ConfirmPresenceModal {
  private destroy$ = new Subject<void>();
  private consultationService = inject(ConsultationService);
  private authService = inject(Auth);
  private confirmationService = inject(ConfirmationService);
  private activeCallService = inject(ActiveCallService);
  private incomingCallService = inject(IncomingCallService);
  private toasterService = inject(ToasterService);
  private router = inject(Router);
  private t = inject(TranslationService);
  private appointmentEarlyJoinMinutes = 10;

  @Input() isOpen = false;
  @Input() appointment: Appointment | null = null;
  @Input() myParticipantId: number | null = null;

  @Output() closed = new EventEmitter<void>();
  @Output() presenceConfirmed = new EventEmitter<void>();
  @Output() editRequested = new EventEmitter<number>();
  @Output() appointmentCancelled = new EventEmitter<void>();

  protected readonly ButtonStyleEnum = ButtonStyleEnum;
  protected readonly ButtonStateEnum = ButtonStateEnum;
  protected readonly ButtonSizeEnum = ButtonSizeEnum;
  protected readonly AppointmentType = AppointmentType;

  isConfirming = signal(false);
  isDeclining = signal(false);
  isJoining = signal(false);
  tooEarlyError = signal<{ time: string; minutes: number } | null>(null);

  get isOnlineAppointment(): boolean {
    return this.appointment?.type === AppointmentType.ONLINE;
  }

  get hasConsultation(): boolean {
    return !!(this.appointment?.consultation_id || this.appointment?.consultation);
  }

  get modalTitle(): string {
    return this.t.instant('confirmPresenceModal.title');
  }

  constructor() {
    this.authService.getOpenIDConfig().pipe(takeUntil(this.destroy$)).subscribe(cfg => {
      if (cfg?.appointment_early_join_minutes) {
        this.appointmentEarlyJoinMinutes = cfg.appointment_early_join_minutes;
      }
    });
  }

  confirmPresence(): void {
    if (!this.myParticipantId) return;
    this.isConfirming.set(true);

    this.consultationService
      .confirmParticipantPresence(String(this.myParticipantId), true)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: () => {
          this.isConfirming.set(false);
          this.toasterService.show(
            'success',
            this.t.instant('confirmPresenceModal.confirmSuccess'),
            this.t.instant('confirmPresenceModal.confirmSuccessMessage')
          );
          this.presenceConfirmed.emit();
          this.onClose();
        },
        error: () => {
          this.isConfirming.set(false);
          this.toasterService.show(
            'error',
            this.t.instant('confirmPresenceModal.confirmError'),
            this.t.instant('confirmPresenceModal.confirmErrorMessage')
          );
        },
      });
  }

  declinePresence(): void {
    if (!this.myParticipantId) return;
    this.isDeclining.set(true);

    this.consultationService
      .confirmParticipantPresence(String(this.myParticipantId), false)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: () => {
          this.isDeclining.set(false);
          this.toasterService.show(
            'warning',
            this.t.instant('confirmPresenceModal.declineSuccess'),
            this.t.instant('confirmPresenceModal.declineSuccessMessage')
          );
          this.presenceConfirmed.emit();
          this.onClose();
        },
        error: () => {
          this.isDeclining.set(false);
          this.toasterService.show(
            'error',
            this.t.instant('confirmPresenceModal.declineError'),
            this.t.instant('confirmPresenceModal.declineErrorMessage')
          );
        },
      });
  }

  joinCall(): void {
    if (!this.appointment) return;

    const now = new Date();
    const scheduledTime = new Date(this.appointment.scheduled_at);
    const earliestJoin = new Date(scheduledTime.getTime() - this.appointmentEarlyJoinMinutes * 60 * 1000);

    if (now < earliestJoin) {
      const time = scheduledTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      this.tooEarlyError.set({ time, minutes: this.appointmentEarlyJoinMinutes });
      setTimeout(() => this.tooEarlyError.set(null), 5000);
      return;
    }

    this.onClose();
    this.activeCallService.startCall({ appointmentId: this.appointment.id });
    this.incomingCallService.setActiveCall(this.appointment.id);
  }

  viewInConsultation(): void {
    if (!this.appointment) return;
    const consultationId = this.appointment.consultation_id || this.appointment.consultation;
    if (consultationId) {
      this.onClose();
      this.router.navigate(
        ['/', RoutePaths.USER, RoutePaths.CONSULTATIONS, consultationId],
        { queryParams: { appointmentId: this.appointment.id } }
      );
    }
  }

  editAppointment(): void {
    if (this.appointment) {
      this.onClose();
      this.editRequested.emit(this.appointment.id);
    }
  }

  async cancelAppointment(): Promise<void> {
    if (!this.appointment) return;

    const confirmed = await this.confirmationService.confirm({
      title: this.t.instant('confirmPresenceModal.cancelTitle'),
      message: this.t.instant('confirmPresenceModal.cancelMessage'),
      confirmText: this.t.instant('confirmPresenceModal.cancelConfirm'),
      cancelText: this.t.instant('confirmPresenceModal.close'),
      confirmStyle: 'danger',
    });

    if (!confirmed) return;

    this.consultationService
      .updateAppointment(this.appointment.id, { status: AppointmentStatus.CANCELLED })
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: () => {
          this.toasterService.show(
            'success',
            this.t.instant('confirmPresenceModal.cancelSuccess'),
            this.t.instant('confirmPresenceModal.cancelSuccessMessage')
          );
          this.appointmentCancelled.emit();
          this.onClose();
        },
        error: () => {
          this.toasterService.show(
            'error',
            this.t.instant('confirmPresenceModal.cancelError'),
            this.t.instant('confirmPresenceModal.cancelErrorMessage')
          );
        },
      });
  }

  onClose(): void {
    this.tooEarlyError.set(null);
    this.closed.emit();
  }

  getParticipantName(participant: Participant): string {
    if (participant.user) {
      const firstName = participant.user.first_name || '';
      const lastName = participant.user.last_name || '';
      const fullName = `${firstName} ${lastName}`.trim();
      return (
        fullName ||
        participant.user.email ||
        this.t.instant('confirmPresenceModal.unknownParticipant')
      );
    }
    return this.t.instant('confirmPresenceModal.unknownParticipant');
  }

  getParticipantStatusColor(status: ParticipantStatus | undefined): string {
    switch (status) {
      case 'confirmed':
        return 'var(--emerald-500)';
      case 'invited':
        return 'var(--blue-500)';
      case 'unavailable':
        return 'var(--rose-500)';
      case 'cancelled':
        return 'var(--slate-400)';
      case 'draft':
        return 'var(--amber-500)';
      default:
        return 'var(--slate-500)';
    }
  }

  getParticipantStatusLabel(status: ParticipantStatus | undefined): string {
    switch (status) {
      case 'confirmed':
        return this.t.instant('confirmPresenceModal.statusConfirmed');
      case 'invited':
        return this.t.instant('confirmPresenceModal.statusPending');
      case 'unavailable':
        return this.t.instant('confirmPresenceModal.statusDeclined');
      case 'cancelled':
        return this.t.instant('confirmPresenceModal.statusCancelled');
      case 'draft':
        return this.t.instant('confirmPresenceModal.statusDraft');
      default:
        return this.t.instant('confirmPresenceModal.unknownParticipant');
    }
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }
}
