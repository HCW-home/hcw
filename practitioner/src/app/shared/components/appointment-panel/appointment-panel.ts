import {
  Component,
  ElementRef,
  HostListener,
  OnDestroy,
  OnInit,
  QueryList,
  ViewChildren,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { Subject, takeUntil } from 'rxjs';
import { trigger, transition, style, animate, query, stagger } from '@angular/animations';
import {
  FullCalendarModule,
  FullCalendarComponent,
} from '@fullcalendar/angular';
import { CalendarOptions, EventInput, EventClickArg, DatesSetArg } from '@fullcalendar/core';
import dayGridPlugin from '@fullcalendar/daygrid';
import timeGridPlugin from '@fullcalendar/timegrid';
import interactionPlugin from '@fullcalendar/interaction';
import { TranslatePipe } from '@ngx-translate/core';

import { ConsultationService } from '../../../core/services/consultation.service';
import { ConfirmationService } from '../../../core/services/confirmation.service';
import { ToasterService } from '../../../core/services/toaster.service';
import { ActiveCallService } from '../../../core/services/active-call.service';
import { IncomingCallService } from '../../../core/services/incoming-call.service';
import { Auth } from '../../../core/services/auth';
import { TranslationService } from '../../../core/services/translation.service';
import { getErrorMessage } from '../../../core/utils/error-helper';
import {
  Appointment,
  AppointmentStatus,
  AppointmentType,
  isJoinableAppointmentStatus,
} from '../../../core/models/consultation';
import { IUser } from '../../../modules/user/models/user';
import { PaginatedResponse } from '../../../core/models/global';

import { Loader } from '../loader/loader';
import { Badge } from '../badge/badge';
import { ParticipantItem } from '../participant-item/participant-item';
import { Svg } from '../../ui-components/svg/svg';
import { Button } from '../../ui-components/button/button';
import {
  ButtonStyleEnum,
  ButtonSizeEnum,
  ButtonStateEnum,
} from '../../constants/button';
import { BadgeTypeEnum, BadgeSizeEnum } from '../../constants/badge';
import {
  getAppointmentBadgeType,
  getAppointmentConsultationId,
  canSetAppointmentOutcome,
  parseDateWithoutTimezone,
} from '../../tools/helper';
import { applyCalendarLocale } from '../../tools/calendar-locale';
import { LocalDatePipe } from '../../pipes/local-date.pipe';

export type AppointmentViewMode = 'list' | 'calendar';
export type AppointmentTimeFilter = 'all' | 'upcoming' | 'past';

/**
 * Which appointments the panel lists. Both variants hit the same endpoint, only
 * the scoping parameter differs.
 */
export type AppointmentPanelSource =
  | { kind: 'consultation'; consultationId: number }
  | { kind: 'patient'; patientId: number };

interface ListParams {
  page?: number;
  page_size?: number;
  status?: string;
  future?: boolean;
  scheduled_at__date__gte?: string;
  scheduled_at__date__lte?: string;
}

/**
 * The appointments block: header with totals, list/calendar switch, time
 * filter, and one card per appointment with its participants and actions.
 *
 * The panel owns listing and the per-appointment actions that are plain API
 * calls (send, join, outcome, cancel). Creating and editing need a context the
 * host provides (a consultation, a pre-filled participant), so those are
 * emitted as `createRequested` / `editRequested` and the host drives its own
 * form modal.
 */
@Component({
  selector: 'app-appointment-panel',
  templateUrl: './appointment-panel.html',
  styleUrl: './appointment-panel.scss',
  imports: [
    CommonModule,
    FullCalendarModule,
    Loader,
    Badge,
    ParticipantItem,
    Svg,
    Button,
    LocalDatePipe,
    TranslatePipe,
  ],
  animations: [
    trigger('listAnimation', [
      transition('* => *', [
        query(':enter', [
          style({ opacity: 0, transform: 'translateY(-10px)' }),
          stagger(50, [
            animate('300ms ease-out', style({ opacity: 1, transform: 'translateY(0)' }))
          ])
        ], { optional: true })
      ])
    ]),
    trigger('fadeIn', [
      transition(':enter', [
        style({ opacity: 0 }),
        animate('200ms ease-out', style({ opacity: 1 }))
      ])
    ])
  ],
})
export class AppointmentPanel implements OnInit, OnDestroy {
  private destroy$ = new Subject<void>();
  private hostEl = inject(ElementRef<HTMLElement>);
  private consultationService = inject(ConsultationService);
  private confirmationService = inject(ConfirmationService);
  private toasterService = inject(ToasterService);
  private activeCallService = inject(ActiveCallService);
  private incomingCallService = inject(IncomingCallService);
  private authService = inject(Auth);
  private t = inject(TranslationService);

  source = input.required<AppointmentPanelSource>();
  /** Hides the "new appointment" call to action. */
  canCreate = input<boolean>(true);
  /** Closed consultation: edit, cancel and outcome are off. */
  locked = input<boolean>(false);
  currentUser = input<IUser | null>(null);
  /**
   * Filter to start on. A host landing on a deep link to a past appointment
   * passes 'all' so the row is in the first page rather than filtered out.
   */
  initialTimeFilter = input<AppointmentTimeFilter>('upcoming');

  createRequested = output<void>();
  editRequested = output<Appointment>();
  /** An appointment the panel itself mutated (send, cancel, outcome). */
  changed = output<Appointment>();
  /** The list after any (re)load, so hosts can mirror it. */
  loaded = output<Appointment[]>();

  protected readonly ButtonStyleEnum = ButtonStyleEnum;
  protected readonly ButtonSizeEnum = ButtonSizeEnum;
  protected readonly ButtonStateEnum = ButtonStateEnum;
  protected readonly BadgeTypeEnum = BadgeTypeEnum;
  protected readonly BadgeSizeEnum = BadgeSizeEnum;
  protected readonly AppointmentStatus = AppointmentStatus;
  protected readonly AppointmentType = AppointmentType;
  protected readonly getAppointmentBadgeType = getAppointmentBadgeType;

  appointments = signal<Appointment[]>([]);
  isLoadingAppointments = signal(false);
  isLoadingMoreAppointments = signal(false);
  hasMoreAppointments = signal(false);
  private appointmentPage = 1;
  private appointmentPageSize = 20;

  // Header summary: totals are independent from the active filter, so they are
  // fetched separately (page_size=1, only the `count` is used).
  upcomingAppointmentCount = signal(0);
  pastAppointmentCount = signal(0);

  // Overflow ("...") menu: id of the appointment whose menu is open.
  openAppointmentMenuId = signal<number | null>(null);

  // Ticks every 30s so the "starts in ..." chip stays accurate without a reload.
  private nowTick = signal(Date.now());
  private nowTickInterval?: ReturnType<typeof setInterval>;

  appointmentViewMode = signal<AppointmentViewMode>('list');
  appointmentTimeFilter = signal<AppointmentTimeFilter>('upcoming');
  calendarComponent = viewChild<FullCalendarComponent>('appointmentCalendar');
  calendarTitle = signal<string>('');
  highlightedAppointmentId = signal<number | null>(null);
  private pendingScrollToAppointmentId: number | null = null;
  private calendarDateRange: { start: string; end: string } | null = null;

  @ViewChildren('appointmentCard') appointmentCards!: QueryList<ElementRef>;

  appointmentEarlyJoinMinutes = 5;
  // Same two settings the backend uses to decide an appointment is over.
  private defaultAppointmentDurationMinutes = signal(30);
  private callLimitJoinMinutes = signal(15);
  private firstDayOfWeek = signal<number>(0);

  tooEarlyError = signal<{ appointmentId: number; time: string; minutes: number } | null>(null);

  calendarEvents = computed<EventInput[]>(() => {
    return this.appointments().map(appointment => ({
      id: appointment.id.toString(),
      title: this.getCalendarEventTitle(appointment),
      start:
        parseDateWithoutTimezone(appointment.scheduled_at) ||
        appointment.scheduled_at,
      end: appointment.end_expected_at
        ? parseDateWithoutTimezone(appointment.end_expected_at) || undefined
        : undefined,
      backgroundColor: this.getStatusColor(appointment.status),
      borderColor: this.getStatusColor(appointment.status),
      textColor: '#ffffff',
      extendedProps: { appointment },
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
    datesSet: this.handleDatesSet.bind(this),
    eventDidMount: (info) => {
      info.el.setAttribute('title', info.event.title);
    },
    slotMinTime: '06:00:00',
    slotMaxTime: '22:00:00',
    allDaySlot: false,
    nowIndicator: true,
    eventTimeFormat: {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    },
  };

  /**
   * The single appointment whose call is reachable right now: the soonest one
   * whose early-join window has opened. Only that card gets the primary
   * "Join" button with its live dot — the others would just answer "too early",
   * so they stay secondary.
   */
  liveAppointmentId = computed<number | null>(() => {
    const now = this.nowTick();
    const earlyMs = this.appointmentEarlyJoinMinutes * 60 * 1000;
    const trailingMs = this.callLimitJoinMinutes() * 60 * 1000;
    const defaultDurationMs =
      this.defaultAppointmentDurationMinutes() * 60 * 1000;

    return (
      this.appointments()
        .filter(a => {
          if (!this.canJoinVideoCall(a)) return false;
          const start = new Date(a.scheduled_at).getTime();
          if (start - now > earlyMs) return false;
          // Mirrors the backend window: an appointment stops being reachable
          // once it is over plus the late-join tolerance. Without an explicit
          // end, the configured default duration applies.
          const end = a.end_expected_at
            ? new Date(a.end_expected_at).getTime()
            : start + defaultDurationMs;
          return end + trailingMs >= now;
        })
        .sort(
          (a, b) =>
            new Date(a.scheduled_at).getTime() -
            new Date(b.scheduled_at).getTime()
        )[0]?.id ?? null
    );
  });

  constructor() {
    // Localize the calendar headers to the user's language and keep the
    // admin-configured first day of week, reacting to changes in either.
    effect(() => {
      const lang = this.t.currentLanguage();
      const firstDay = this.firstDayOfWeek();
      const api = this.calendarComponent()?.getApi();
      applyCalendarLocale(api, lang, firstDay);
    });
  }

  ngOnInit(): void {
    this.appointmentTimeFilter.set(this.initialTimeFilter());
    this.nowTickInterval = setInterval(() => this.nowTick.set(Date.now()), 30000);

    this.authService.getOpenIDConfig().subscribe({
      next: config => {
        this.appointmentEarlyJoinMinutes = config.appointment_early_join_minutes || 5;
        this.defaultAppointmentDurationMinutes.set(
          config.default_appointment_duration_in_minutes || 30
        );
        this.callLimitJoinMinutes.set(config.call_limit_join_minutes || 15);
        this.firstDayOfWeek.set(config.calendar_first_day_of_week ?? 0);
      },
      error: () => {
        // Defaults above are the same as the backend's, so the panel stays usable.
      },
    });

    this.loadAppointments();
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
    if (this.nowTickInterval) {
      clearInterval(this.nowTickInterval);
    }
  }

  // --- Public API for hosts --------------------------------------------------

  /** Reload the current view (list or calendar). */
  reload(): void {
    if (this.appointmentViewMode() === 'calendar') {
      this.loadAppointmentsForCalendar();
    } else {
      this.loadAppointments();
    }
  }

  /** Insert or replace one appointment, e.g. from a websocket event. */
  upsert(appointment: Appointment): void {
    const current = this.appointments();
    const exists = current.some(a => a.id === appointment.id);
    this.appointments.set(
      exists
        ? current.map(a => (a.id === appointment.id ? appointment : a))
        : [...current, appointment].sort(
            (a, b) =>
              new Date(a.scheduled_at).getTime() -
              new Date(b.scheduled_at).getTime()
          )
    );
    this.refreshAppointmentCounts();
    this.loaded.emit(this.appointments());
  }

  remove(appointmentId: number): void {
    this.appointments.set(
      this.appointments().filter(a => a.id !== appointmentId)
    );
    this.refreshAppointmentCounts();
    this.loaded.emit(this.appointments());
  }

  /** Flash a card and bring it into view (deep links, websocket nudges). */
  highlight(appointmentId: number): void {
    this.highlightedAppointmentId.set(appointmentId);
    this.pendingScrollToAppointmentId = appointmentId;
    setTimeout(() => this.scrollToAppointment(appointmentId), 300);
  }

  // --- Loading ---------------------------------------------------------------

  private fetch(params: ListParams) {
    const source = this.source();
    return source.kind === 'consultation'
      ? this.consultationService.getConsultationAppointments(
          source.consultationId,
          params
        )
      : this.consultationService.getAppointments({
          ...params,
          consultation__beneficiary: source.patientId,
        });
  }

  private onLoaded(response: PaginatedResponse<Appointment>, append: boolean): void {
    this.appointments.set(
      append ? [...this.appointments(), ...response.results] : response.results
    );
    this.loaded.emit(this.appointments());
    if (this.pendingScrollToAppointmentId) {
      setTimeout(() => this.scrollToAppointment(this.pendingScrollToAppointmentId!), 300);
    }
  }

  private showLoadError(error: HttpErrorResponse): void {
    this.toasterService.show(
      'error',
      this.t.instant('consultationDetail.errorLoadingAppointments'),
      getErrorMessage(error)
    );
  }

  private timeParams(): ListParams {
    const timeFilter = this.appointmentTimeFilter();
    if (timeFilter === 'upcoming') return { future: true };
    if (timeFilter === 'past') return { future: false };
    return {};
  }

  loadAppointments(): void {
    this.isLoadingAppointments.set(true);
    this.appointmentPage = 1;
    this.refreshAppointmentCounts();

    this.fetch({
      page: 1,
      page_size: this.appointmentPageSize,
      ...this.timeParams(),
    })
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: response => {
          this.onLoaded(response, false);
          this.hasMoreAppointments.set(response.next !== null);
          this.isLoadingAppointments.set(false);
        },
        error: error => {
          this.isLoadingAppointments.set(false);
          this.showLoadError(error);
        },
      });
  }

  loadMoreAppointments(): void {
    if (this.isLoadingMoreAppointments() || !this.hasMoreAppointments()) return;

    this.isLoadingMoreAppointments.set(true);
    this.appointmentPage++;

    this.fetch({
      page: this.appointmentPage,
      page_size: this.appointmentPageSize,
      ...this.timeParams(),
    })
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: response => {
          this.onLoaded(response, true);
          this.hasMoreAppointments.set(response.next !== null);
          this.isLoadingMoreAppointments.set(false);
        },
        error: error => {
          this.appointmentPage--;
          this.isLoadingMoreAppointments.set(false);
          this.showLoadError(error);
        },
      });
  }

  loadAppointmentsForCalendar(): void {
    this.refreshAppointmentCounts();
    if (!this.calendarDateRange) return;

    this.isLoadingAppointments.set(true);
    this.fetch({
      page_size: 100,
      scheduled_at__date__gte: this.calendarDateRange.start,
      scheduled_at__date__lte: this.calendarDateRange.end,
    })
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: response => {
          this.onLoaded(response, false);
          this.hasMoreAppointments.set(false);
          this.isLoadingAppointments.set(false);
        },
        error: error => {
          this.isLoadingAppointments.set(false);
          this.showLoadError(error);
        },
      });
  }

  /**
   * Header summary ("2 upcoming - 5 past"). The list itself is filtered and
   * paginated, so the totals need their own lightweight requests: page_size=1
   * and only `count` is read from the response.
   */
  private refreshAppointmentCounts(): void {
    this.fetch({
      page: 1,
      page_size: 1,
      status: AppointmentStatus.SCHEDULED,
      future: true,
    })
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: response => this.upcomingAppointmentCount.set(response.count),
        error: () => this.upcomingAppointmentCount.set(0),
      });

    this.fetch({ page: 1, page_size: 1, future: false })
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: response => this.pastAppointmentCount.set(response.count),
        error: () => this.pastAppointmentCount.set(0),
      });
  }

  // --- Per-appointment actions ----------------------------------------------

  private replace(updated: Appointment): void {
    this.appointments.set(
      this.appointments().map(a => (a.id === updated.id ? updated : a))
    );
    this.changed.emit(updated);
    this.loaded.emit(this.appointments());
  }

  sendAppointment(appointment: Appointment): void {
    this.consultationService
      .sendAppointment(appointment.id)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: updated => {
          this.replace(updated);
          this.toasterService.show(
            'success',
            this.t.instant('consultationDetail.appointmentSent'),
            this.t.instant('consultationDetail.appointmentSentMessage')
          );
        },
        error: error => {
          this.toasterService.show(
            'error',
            this.t.instant('consultationDetail.errorSendingAppointment'),
            getErrorMessage(error)
          );
        },
      });
  }

  async cancelAppointment(appointment: Appointment): Promise<void> {
    const confirmed = await this.confirmationService.confirm({
      title: this.t.instant('consultationDetail.cancelAppointmentTitle'),
      message: this.t.instant('consultationDetail.cancelAppointmentMessage'),
      confirmText: this.t.instant('consultationDetail.cancelAppointmentConfirm'),
      cancelText: this.t.instant('consultationDetail.goBack'),
      confirmStyle: 'danger',
    });
    if (!confirmed) return;

    this.consultationService
      .updateAppointment(appointment.id, { status: AppointmentStatus.CANCELLED })
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: updated => {
          this.replace(updated);
          this.refreshAppointmentCounts();
          this.toasterService.show(
            'success',
            this.t.instant('consultationDetail.appointmentCancelled'),
            this.t.instant('consultationDetail.appointmentCancelledMessage')
          );
        },
        error: error => {
          this.toasterService.show(
            'error',
            this.t.instant('consultationDetail.errorCancellingAppointment'),
            getErrorMessage(error)
          );
        },
      });
  }

  setAppointmentOutcome(
    appointment: Appointment,
    status: AppointmentStatus
  ): void {
    this.consultationService
      .setAppointmentStatus(appointment.id, status)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: updated => {
          this.replace(updated);
          this.refreshAppointmentCounts();
          this.toasterService.show(
            'success',
            this.t.instant('appointments.setStatusSuccess')
          );
        },
        error: error => {
          this.toasterService.show(
            'error',
            this.t.instant('appointments.setStatusError'),
            getErrorMessage(error)
          );
        },
      });
  }

  /**
   * can_join is the server's own answer, which also covers "am I on the
   * roster" — the backend rejects a join from a non-participant. Older
   * payloads without the flag fall back to the local rule.
   */
  canJoinVideoCall(appointment: Appointment): boolean {
    if (appointment.can_join !== undefined) return appointment.can_join;
    return (
      isJoinableAppointmentStatus(appointment.status) &&
      appointment.type === AppointmentType.ONLINE
    );
  }

  joinVideoCall(appointmentId: number): void {
    const appointment = this.appointments().find(a => a.id === appointmentId);
    if (!appointment) {
      this.toasterService.show(
        'error',
        this.t.instant('consultationDetail.error'),
        this.t.instant('consultationDetail.appointmentNotFound')
      );
      return;
    }

    const now = new Date();
    const scheduledTime = new Date(appointment.scheduled_at);
    const earliestJoin = new Date(
      scheduledTime.getTime() - this.appointmentEarlyJoinMinutes * 60 * 1000
    );

    if (now < earliestJoin) {
      const scheduledTimeStr = scheduledTime.toLocaleTimeString([], {
        hour: '2-digit',
        minute: '2-digit',
      });
      this.tooEarlyError.set({
        appointmentId: appointment.id,
        time: scheduledTimeStr,
        minutes: this.appointmentEarlyJoinMinutes,
      });
      setTimeout(() => {
        if (this.tooEarlyError()?.appointmentId === appointment.id) {
          this.tooEarlyError.set(null);
        }
      }, 5000);
      return;
    }

    this.activeCallService.startCall({
      appointmentId,
      consultationId: getAppointmentConsultationId(appointment) ?? undefined,
    });
    this.incomingCallService.setActiveCall(appointmentId);
  }

  // --- Action availability ---------------------------------------------------

  getAppointmentStatusLabel(status: AppointmentStatus): string {
    const keys: Record<AppointmentStatus, string> = {
      [AppointmentStatus.DRAFT]: 'consultationDetail.statusDraft',
      [AppointmentStatus.SCHEDULED]: 'consultationDetail.statusScheduled',
      [AppointmentStatus.COMPLETED]: 'consultationDetail.statusCompleted',
      [AppointmentStatus.NOSHOW]: 'consultationDetail.statusNoshow',
      [AppointmentStatus.CANCELLED]: 'consultationDetail.statusCancelled',
    };
    const key = keys[status];
    return key ? this.t.instant(key) : String(status);
  }

  canSetOutcome(appointment: Appointment): boolean {
    return canSetAppointmentOutcome(appointment);
  }

  /**
   * A settled appointment (completed / no-show) stays editable: the API allows
   * it on purpose — see `validate_scheduled_at` on the backend serializer — and
   * a wrong time or title still needs fixing after the fact. Only a cancelled
   * appointment is frozen: it is replaced by a new one rather than amended.
   */
  canEditAppointment(appointment: Appointment): boolean {
    return !this.locked() && appointment.status !== AppointmentStatus.CANCELLED;
  }

  canCancelAppointment(appointment: Appointment): boolean {
    return (
      !this.locked() &&
      (appointment.status === AppointmentStatus.DRAFT ||
        appointment.status === AppointmentStatus.SCHEDULED)
    );
  }

  canMarkCompleted(appointment: Appointment): boolean {
    return (
      this.canSetOutcome(appointment) &&
      !this.locked() &&
      appointment.status !== AppointmentStatus.COMPLETED
    );
  }

  /**
   * A video appointment already carries "Join" as its primary action, so the
   * outcome moves into the overflow menu next to "No show". In-person ones have
   * no call to join: their outcome stays a visible one-click action.
   */
  isCompleteInMenu(appointment: Appointment): boolean {
    return (
      this.canMarkCompleted(appointment) &&
      appointment.type === AppointmentType.ONLINE
    );
  }

  canMarkNoshow(appointment: Appointment): boolean {
    return (
      this.canSetOutcome(appointment) &&
      appointment.status !== AppointmentStatus.NOSHOW
    );
  }

  hasAppointmentMenuActions(appointment: Appointment): boolean {
    return (
      this.canEditAppointment(appointment) ||
      this.isCompleteInMenu(appointment) ||
      this.canMarkNoshow(appointment) ||
      this.canCancelAppointment(appointment)
    );
  }

  // --- Presentation ----------------------------------------------------------

  /**
   * Relative label shown next to an upcoming appointment ("in 21 min").
   * Returns null when the appointment is not scheduled, already started, or
   * more than a day away — the absolute date is enough in those cases.
   */
  getAppointmentCountdown(appointment: Appointment): string | null {
    if (appointment.status !== AppointmentStatus.SCHEDULED) return null;

    const start = new Date(appointment.scheduled_at).getTime();
    if (isNaN(start)) return null;

    const diffMs = start - this.nowTick();
    if (diffMs > 24 * 60 * 60 * 1000) return null;

    const earlyMs = this.appointmentEarlyJoinMinutes * 60 * 1000;
    if (diffMs <= earlyMs) {
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

  getAppointmentTypeLabel(appointment: Appointment): string {
    return appointment.type === AppointmentType.ONLINE
      ? this.t.instant('consultationDetail.typeOnline')
      : this.t.instant('consultationDetail.typeInPerson');
  }

  // --- Overflow menu ---------------------------------------------------------

  toggleAppointmentMenu(appointment: Appointment, event: MouseEvent): void {
    event.stopPropagation();
    this.openAppointmentMenuId.set(
      this.openAppointmentMenuId() === appointment.id ? null : appointment.id
    );
  }

  closeAppointmentMenu(): void {
    this.openAppointmentMenuId.set(null);
  }

  @HostListener('document:click', ['$event'])
  onDocumentClick(event: MouseEvent): void {
    const openId = this.openAppointmentMenuId();
    if (openId === null) return;
    const target = event.target as HTMLElement;
    // Scoped to the open card: every card renders its own menu container.
    const menu = this.hostEl.nativeElement.querySelector(
      `.appointment-menu[data-appointment-id="${openId}"]`
    );
    if (!menu || !menu.contains(target)) {
      this.closeAppointmentMenu();
    }
  }

  // --- Filters and calendar --------------------------------------------------

  setAppointmentViewMode(mode: AppointmentViewMode): void {
    const previousMode = this.appointmentViewMode();
    this.appointmentViewMode.set(mode);

    if (mode === 'calendar' && previousMode === 'list') {
      if (this.calendarDateRange) {
        this.loadAppointmentsForCalendar();
      }
    } else if (mode === 'list' && previousMode === 'calendar') {
      this.loadAppointments();
    }
  }

  setAppointmentTimeFilter(tabId: string): void {
    this.appointmentTimeFilter.set(tabId as AppointmentTimeFilter);
    this.loadAppointments();
  }

  private getCalendarEventTitle(appointment: Appointment): string {
    const typeLabel =
      appointment.type === AppointmentType.ONLINE
        ? this.t.instant('consultationDetail.video')
        : this.t.instant('consultationDetail.inPersonLabel');
    return appointment.title ? `${appointment.title} (${typeLabel})` : typeLabel;
  }

  private getStatusColor(status: AppointmentStatus): string {
    switch (status) {
      case AppointmentStatus.SCHEDULED:
        return '#3b82f6';
      case AppointmentStatus.COMPLETED:
        return '#10b981';
      case AppointmentStatus.NOSHOW:
        return '#f97316';
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
      this.editRequested.emit(appointment);
    }
  }

  calendarPrev(): void {
    setTimeout(() => this.calendarComponent()?.getApi()?.prev());
  }

  calendarNext(): void {
    setTimeout(() => this.calendarComponent()?.getApi()?.next());
  }

  calendarToday(): void {
    setTimeout(() => this.calendarComponent()?.getApi()?.today());
  }

  getCalendarTitle(): string {
    return this.calendarTitle();
  }

  handleDatesSet(arg: DatesSetArg): void {
    this.calendarTitle.set(arg.view.title);

    const formatDate = (date: Date): string => {
      const year = date.getFullYear();
      const month = String(date.getMonth() + 1).padStart(2, '0');
      const day = String(date.getDate()).padStart(2, '0');
      return `${year}-${month}-${day}`;
    };

    const newStart = formatDate(arg.start);
    const newEnd = formatDate(arg.end);

    if (
      !this.calendarDateRange ||
      this.calendarDateRange.start !== newStart ||
      this.calendarDateRange.end !== newEnd
    ) {
      this.calendarDateRange = { start: newStart, end: newEnd };
      if (this.appointmentViewMode() === 'calendar') {
        this.loadAppointmentsForCalendar();
      }
    }
  }

  private scrollToAppointment(appointmentId: number): void {
    if (!this.appointmentCards) return;

    const cardRef = this.appointmentCards.find(
      el => +el.nativeElement.dataset['appointmentId'] === appointmentId
    );

    if (cardRef) {
      cardRef.nativeElement.scrollIntoView({
        behavior: 'smooth',
        block: 'center',
      });
      this.pendingScrollToAppointmentId = null;
    }
  }
}
