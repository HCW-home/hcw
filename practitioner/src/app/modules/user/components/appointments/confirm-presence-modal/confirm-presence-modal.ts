import {
  Component,
  Input,
  Output,
  EventEmitter,
  OnChanges,
  SimpleChanges,
  inject,
  signal,
  OnDestroy,
} from '@angular/core';
import { formatDate } from '@angular/common';
import { Router } from '@angular/router';
import { Subject, takeUntil } from 'rxjs';
import { TranslatePipe } from '@ngx-translate/core';
import { ModalComponent } from '../../../../../shared/components/modal/modal.component';
import { Button } from '../../../../../shared/ui-components/button/button';
import { Svg } from '../../../../../shared/ui-components/svg/svg';
import { Badge } from '../../../../../shared/components/badge/badge';
import { ParticipantItem } from '../../../../../shared/components/participant-item/participant-item';
import { ConsultationService } from '../../../../../core/services/consultation.service';
import { UserService } from '../../../../../core/services/user.service';
import { Auth } from '../../../../../core/services/auth';
import { ToasterService } from '../../../../../core/services/toaster.service';
import { TranslationService } from '../../../../../core/services/translation.service';
import {
  Appointment,
  AppointmentStatus,
  AppointmentType,
  Participant,
  ParticipantStatus,
  isJoinableAppointmentStatus,
} from '../../../../../core/models/consultation';
import { IUser } from '../../../models/user';
import {
  ButtonStyleEnum,
  ButtonSizeEnum,
} from '../../../../../shared/constants/button';
import { BadgeType } from '../../../../../shared/models/badge';
import { BadgeTypeEnum, BadgeSizeEnum } from '../../../../../shared/constants/badge';
import { ActiveCallService } from '../../../../../core/services/active-call.service';
import { IncomingCallService } from '../../../../../core/services/incoming-call.service';
import { RoutePaths } from '../../../../../core/constants/routes';
import {
  formatConsultationId,
  formatUserName,
  getAppointmentBadgeType,
  getAppointmentConsultationId,
  parseDateWithoutTimezone,
} from '../../../../../shared/tools/helper';

/** Where the current user stands on this appointment, once normalised. */
type PresenceAnswer = 'confirmed' | 'declined' | null;

@Component({
  selector: 'app-confirm-presence-modal',
  templateUrl: './confirm-presence-modal.html',
  styleUrl: './confirm-presence-modal.scss',
  imports: [
    ModalComponent,
    Button,
    Svg,
    Badge,
    ParticipantItem,
    TranslatePipe,
  ],
})
export class ConfirmPresenceModal implements OnChanges, OnDestroy {
  private destroy$ = new Subject<void>();
  private consultationService = inject(ConsultationService);
  private userService = inject(UserService);
  private authService = inject(Auth);
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
  // Carries the answered appointment so the host can bring it into view.
  @Output() presenceConfirmed = new EventEmitter<Appointment | null>();
  @Output() editRequested = new EventEmitter<number>();
  @Output() appointmentCancelled = new EventEmitter<void>();

  protected readonly ButtonStyleEnum = ButtonStyleEnum;
  protected readonly ButtonSizeEnum = ButtonSizeEnum;
  protected readonly BadgeTypeEnum = BadgeTypeEnum;
  protected readonly BadgeSizeEnum = BadgeSizeEnum;
  protected readonly AppointmentStatus = AppointmentStatus;

  isConfirming = signal(false);
  isDeclining = signal(false);
  isCancelling = signal(false);
  tooEarlyError = signal<{ time: string; minutes: number } | null>(null);

  /**
   * Cancelling used to sit in the top action row next to "Close", where the
   * two read as the same thing. It now lives behind the overflow button, with
   * its confirmation inline instead of a second dialog stacked on this one.
   */
  cancelConfirmOpen = signal(false);

  /**
   * Own copy of the roster: answering updates the participant in place so the
   * modal reflects the new status without waiting for the host to reload.
   */
  participants = signal<Participant[]>([]);

  private nowTick = signal(Date.now());
  private nowTickInterval?: ReturnType<typeof setInterval>;

  constructor() {
    this.authService.getOpenIDConfig().pipe(takeUntil(this.destroy$)).subscribe(cfg => {
      if (cfg?.appointment_early_join_minutes) {
        this.appointmentEarlyJoinMinutes = cfg.appointment_early_join_minutes;
      }
    });
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['appointment']) {
      this.participants.set(this.appointment?.participants ?? []);
    }
    if (changes['isOpen']) {
      this.cancelConfirmOpen.set(false);
      this.tooEarlyError.set(null);
      // The countdown only has to move while the modal is on screen.
      if (this.isOpen) {
        this.startNowTicker();
      } else {
        this.stopNowTicker();
      }
    }
  }

  ngOnDestroy(): void {
    this.stopNowTicker();
    this.destroy$.next();
    this.destroy$.complete();
  }

  // --- Header ----------------------------------------------------------------

  /**
   * The date is the title: "Rendez-vous" said nothing the modal did not
   * already say, while the moment it happens is what identifies it.
   */
  get dateTitle(): string {
    const day = this.formatLocal(this.appointment?.scheduled_at, 'EEEE d MMMM');
    if (!day) return this.t.instant('confirmPresenceModal.title');

    return this.t.instant('confirmPresenceModal.dateTimeTitle', {
      date: day.charAt(0).toUpperCase() + day.slice(1),
      time: this.formatLocal(this.appointment?.scheduled_at, 'HH:mm'),
    });
  }

  get isOnlineAppointment(): boolean {
    return this.appointment?.type === AppointmentType.ONLINE;
  }

  get typeLabel(): string {
    return this.t.instant(
      this.isOnlineAppointment
        ? 'confirmPresenceModal.videoConsultation'
        : 'confirmPresenceModal.inPersonVisit'
    );
  }

  get statusLabel(): string {
    const keys: Record<AppointmentStatus, string> = {
      [AppointmentStatus.DRAFT]: 'consultationDetail.statusDraft',
      [AppointmentStatus.SCHEDULED]: 'consultationDetail.statusScheduled',
      [AppointmentStatus.COMPLETED]: 'consultationDetail.statusCompleted',
      [AppointmentStatus.NOSHOW]: 'consultationDetail.statusNoshow',
      [AppointmentStatus.CANCELLED]: 'consultationDetail.statusCancelled',
    };
    const key = this.appointment ? keys[this.appointment.status] : null;
    return key ? this.t.instant(key) : '';
  }

  get statusBadgeType(): BadgeType {
    return this.appointment
      ? getAppointmentBadgeType(this.appointment.status)
      : BadgeTypeEnum.gray;
  }

  /**
   * Relative label for an appointment that is about to start ("in 21 min").
   * Silent beyond a day: the date in the title is enough by then.
   */
  get countdown(): string | null {
    if (this.appointment?.status !== AppointmentStatus.SCHEDULED) return null;

    const start = parseDateWithoutTimezone(this.appointment.scheduled_at);
    if (!start) return null;

    const diffMs = start.getTime() - this.nowTick();
    if (diffMs > 24 * 60 * 60 * 1000) return null;
    if (diffMs <= this.appointmentEarlyJoinMinutes * 60 * 1000) {
      return this.t.instant('consultationDetail.startingNow');
    }

    const minutes = Math.round(diffMs / 60000);
    if (minutes < 60) {
      return this.t.instant('consultationDetail.startsInMinutes', {
        minutes: String(minutes),
      });
    }
    return this.t.instant('consultationDetail.startsInHours', {
      hours: String(Math.round(minutes / 60)),
    });
  }

  /** "Expected duration 30 min · Europe/Paris" — whichever part is known. */
  get metaLine(): string {
    const parts: string[] = [];

    const duration = this.durationLabel;
    if (duration) {
      parts.push(this.t.instant('confirmPresenceModal.duration', { duration }));
    }

    const timezone = this.currentUser?.timezone;
    if (timezone) parts.push(timezone);

    return parts.join(' · ');
  }

  private get durationLabel(): string | null {
    const start = parseDateWithoutTimezone(this.appointment?.scheduled_at ?? '');
    const end = parseDateWithoutTimezone(this.appointment?.end_expected_at ?? '');
    if (!start || !end) return null;

    const total = Math.round((end.getTime() - start.getTime()) / 60000);
    if (total <= 0) return null;

    const hours = Math.floor(total / 60);
    const minutes = total % 60;

    if (!hours) {
      return this.t.instant('confirmPresenceModal.durationMinutes', {
        minutes: String(minutes),
      });
    }
    if (!minutes) {
      return this.t.instant('confirmPresenceModal.durationHours', {
        hours: String(hours),
      });
    }
    return this.t.instant('confirmPresenceModal.durationHoursMinutes', {
      hours: String(hours),
      minutes: String(minutes),
    });
  }

  // --- Actions ---------------------------------------------------------------

  /**
   * can_join is the server's own answer, which also covers "am I on the
   * roster". Older payloads without the flag fall back to the local rule.
   */
  get canJoin(): boolean {
    if (!this.appointment) return false;
    if (this.appointment.can_join !== undefined) return this.appointment.can_join;
    return (
      isJoinableAppointmentStatus(this.appointment.status) &&
      this.isOnlineAppointment
    );
  }

  /** A cancelled appointment is replaced by a new one rather than amended. */
  get canEdit(): boolean {
    return (
      !!this.appointment && this.appointment.status !== AppointmentStatus.CANCELLED
    );
  }

  get canCancel(): boolean {
    return (
      this.appointment?.status === AppointmentStatus.DRAFT ||
      this.appointment?.status === AppointmentStatus.SCHEDULED
    );
  }

  joinCall(): void {
    if (!this.appointment) return;

    const now = new Date();
    const scheduledTime = new Date(this.appointment.scheduled_at);
    const earliestJoin = new Date(
      scheduledTime.getTime() - this.appointmentEarlyJoinMinutes * 60 * 1000
    );

    if (now < earliestJoin) {
      const time = scheduledTime.toLocaleTimeString([], {
        hour: '2-digit',
        minute: '2-digit',
      });
      this.tooEarlyError.set({ time, minutes: this.appointmentEarlyJoinMinutes });
      setTimeout(() => this.tooEarlyError.set(null), 5000);
      return;
    }

    this.onClose();
    this.activeCallService.startCall({
      appointmentId: this.appointment.id,
      consultationId: this.consultationId ?? undefined,
    });
    this.incomingCallService.setActiveCall(this.appointment.id);
  }

  editAppointment(): void {
    if (!this.appointment) return;
    this.onClose();
    this.editRequested.emit(this.appointment.id);
  }

  toggleCancelConfirm(): void {
    this.cancelConfirmOpen.update(open => !open);
  }

  cancelAppointment(): void {
    if (!this.appointment || this.isCancelling()) return;
    this.isCancelling.set(true);

    this.consultationService
      .updateAppointment(this.appointment.id, {
        status: AppointmentStatus.CANCELLED,
      })
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: () => {
          this.isCancelling.set(false);
          this.toasterService.show(
            'success',
            this.t.instant('confirmPresenceModal.cancelSuccess'),
            this.t.instant('confirmPresenceModal.cancelSuccessMessage')
          );
          this.appointmentCancelled.emit();
          this.onClose();
        },
        error: () => {
          this.isCancelling.set(false);
          this.toasterService.show(
            'error',
            this.t.instant('confirmPresenceModal.cancelError'),
            this.t.instant('confirmPresenceModal.cancelErrorMessage')
          );
        },
      });
  }

  // --- Presence --------------------------------------------------------------

  get myParticipant(): Participant | null {
    if (!this.myParticipantId) return null;
    return this.participants().find(p => p.id === this.myParticipantId) ?? null;
  }

  /** Only asked while the appointment can still be attended. */
  get showPresenceRow(): boolean {
    return (
      !!this.myParticipant &&
      this.appointment?.status === AppointmentStatus.SCHEDULED
    );
  }

  get presenceAnswer(): PresenceAnswer {
    const status = this.myParticipant?.status;
    if (status === 'confirmed' || status === 'arrived') return 'confirmed';
    if (status === 'unavailable') return 'declined';
    return null;
  }

  get presenceLabel(): string {
    const answer = this.presenceAnswer;
    if (answer === 'confirmed') {
      return this.t.instant('confirmPresenceModal.presenceConfirmed');
    }
    if (answer === 'declined') {
      return this.t.instant('confirmPresenceModal.presenceDeclined');
    }
    return this.t.instant('confirmPresenceModal.presenceQuestion');
  }

  get isAnswering(): boolean {
    return this.isConfirming() || this.isDeclining();
  }

  confirmPresence(): void {
    if (this.presenceAnswer === 'confirmed') return;
    this.answerPresence(true);
  }

  declinePresence(): void {
    if (this.presenceAnswer === 'declined') return;
    this.answerPresence(false);
  }

  private answerPresence(attending: boolean): void {
    if (!this.myParticipantId || this.isAnswering) return;

    const pending = attending ? this.isConfirming : this.isDeclining;
    pending.set(true);

    this.consultationService
      .confirmParticipantPresence(String(this.myParticipantId), attending)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: () => {
          pending.set(false);
          this.applyMyStatus(attending ? 'confirmed' : 'unavailable');
          this.toasterService.show(
            attending ? 'success' : 'warning',
            this.t.instant(
              attending
                ? 'confirmPresenceModal.confirmSuccess'
                : 'confirmPresenceModal.declineSuccess'
            ),
            this.t.instant(
              attending
                ? 'confirmPresenceModal.confirmSuccessMessage'
                : 'confirmPresenceModal.declineSuccessMessage'
            )
          );
          // The modal stays open on purpose: the answer is shown in place
          // instead of dropping the user back on the calendar.
          this.presenceConfirmed.emit(this.appointment);
        },
        error: () => {
          pending.set(false);
          this.toasterService.show(
            'error',
            this.t.instant(
              attending
                ? 'confirmPresenceModal.confirmError'
                : 'confirmPresenceModal.declineError'
            ),
            this.t.instant(
              attending
                ? 'confirmPresenceModal.confirmErrorMessage'
                : 'confirmPresenceModal.declineErrorMessage'
            )
          );
        },
      });
  }

  private applyMyStatus(status: ParticipantStatus): void {
    this.participants.update(list =>
      list.map(p => (p.id === this.myParticipantId ? { ...p, status } : p))
    );
  }

  // --- Consultation ----------------------------------------------------------

  get consultationId(): number | null {
    return getAppointmentConsultationId(this.appointment);
  }

  get hasConsultation(): boolean {
    return this.consultationId !== null;
  }

  get consultationRef(): string {
    const id = this.consultationId;
    return id ? formatConsultationId(id) : '';
  }

  get consultationTitle(): string {
    return (
      this.appointment?.consultation_title ||
      this.t.instant('confirmPresenceModal.untitledConsultation')
    );
  }

  viewInConsultation(): void {
    const consultationId = this.consultationId;
    if (!this.appointment || !consultationId) return;

    this.onClose();
    this.router.navigate(
      ['/', RoutePaths.USER, RoutePaths.CONSULTATIONS, consultationId],
      { queryParams: { appointmentId: this.appointment.id } }
    );
  }

  // --- Participants ----------------------------------------------------------

  get currentUser(): IUser | null {
    return this.userService.currentUserValue;
  }

  get participantsSummary(): string {
    const confirmed = this.participants().filter(
      p => p.status === 'confirmed' || p.status === 'arrived'
    ).length;

    return confirmed
      ? this.t.instant('confirmPresenceModal.participantsConfirmedCount', {
          count: String(confirmed),
        })
      : this.t.instant('confirmPresenceModal.participantsNoAnswer');
  }

  // --- Footer ----------------------------------------------------------------

  get createdLabel(): string {
    const date = this.formatLocal(this.appointment?.created_at, 'd MMMM y');
    if (!date) return '';

    return this.t.instant('confirmPresenceModal.createdOn', {
      date,
      name: formatUserName(this.appointment?.created_by),
    });
  }

  onClose(): void {
    this.tooEarlyError.set(null);
    this.cancelConfirmOpen.set(false);
    this.closed.emit();
  }

  // --- Internals -------------------------------------------------------------

  /**
   * Same convention as LocalDatePipe: the API sends the time already expressed
   * in the user's timezone, so the offset in the ISO string is ignored.
   */
  private formatLocal(value: string | null | undefined, format: string): string {
    const date = parseDateWithoutTimezone(value ?? '');
    if (!date) return '';
    return formatDate(date, format, this.t.currentLanguage() || 'en');
  }

  private startNowTicker(): void {
    this.nowTick.set(Date.now());
    if (this.nowTickInterval) return;
    this.nowTickInterval = setInterval(() => this.nowTick.set(Date.now()), 30000);
  }

  private stopNowTicker(): void {
    if (!this.nowTickInterval) return;
    clearInterval(this.nowTickInterval);
    this.nowTickInterval = undefined;
  }
}
