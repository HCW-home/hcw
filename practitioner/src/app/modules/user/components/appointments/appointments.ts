import {
  Component,
  OnInit,
  OnDestroy,
  AfterViewInit,
  signal,
  inject,
  viewChild,
  ElementRef,
  HostListener,
} from '@angular/core';
import { Router, ActivatedRoute } from '@angular/router';
import { CommonModule } from '@angular/common';
import { Subject, forkJoin, takeUntil } from 'rxjs';
import { FormsModule } from '@angular/forms';
import {
  FullCalendarModule,
  FullCalendarComponent,
} from '@fullcalendar/angular';
import {
  CalendarOptions,
  EventInput,
  EventClickArg,
  EventHoveringArg,
  DatesSetArg,
  DateSelectArg,
  EventDropArg,
} from '@fullcalendar/core';
import { EventResizeDoneArg } from '@fullcalendar/interaction';
import dayGridPlugin from '@fullcalendar/daygrid';
import timeGridPlugin from '@fullcalendar/timegrid';
import interactionPlugin from '@fullcalendar/interaction';
import { Page } from '../../../../core/components/page/page';
import { Loader } from '../../../../shared/components/loader/loader';
import { Badge } from '../../../../shared/components/badge/badge';
import { BadgeTypeEnum } from '../../../../shared/constants/badge';
import { Svg } from '../../../../shared/ui-components/svg/svg';
import { Button } from '../../../../shared/ui-components/button/button';
import {
  ButtonStyleEnum,
  ButtonSizeEnum,
} from '../../../../shared/constants/button';
import { ConsultationService } from '../../../../core/services/consultation.service';
import { IncomingCallService } from '../../../../core/services/incoming-call.service';
import { ActiveCallService } from '../../../../core/services/active-call.service';
import { ToasterService } from '../../../../core/services/toaster.service';
import {
  Appointment,
  AppointmentStatus,
  AppointmentType,
  Participant,
  ParticipantStatus,
} from '../../../../core/models/consultation';
import { RoutePaths } from '../../../../core/constants/routes';
import {
  getAppointmentBadgeType,
  parseDateWithoutTimezone,
} from '../../../../shared/tools/helper';
import { getErrorMessage } from '../../../../core/utils/error-helper';
import { LocalDatePipe } from '../../../../shared/pipes/local-date.pipe';
import { TranslatePipe } from '@ngx-translate/core';
import { TranslationService } from '../../../../core/services/translation.service';
import { UserService } from '../../../../core/services/user.service';
import { Auth } from '../../../../core/services/auth';
import { ConfirmPresenceModal } from './confirm-presence-modal/confirm-presence-modal';
import { AppointmentFormModal } from '../consultation-detail/appointment-form-modal/appointment-form-modal';
import { ReminderFormModal } from '../../../../shared/components/reminder-form-modal/reminder-form-modal';
import {
  ElementTypeModal,
  ElementType,
} from '../../../../shared/components/element-type-modal/element-type-modal';
import { ReminderDetailModal } from '../../../../shared/components/reminder-detail-modal/reminder-detail-modal';
import { ReminderCard } from '../../../../shared/components/reminder-card/reminder-card';
import { Reminder, ReminderOccurrence } from '../../../../core/models/reminder';
import { ConfirmationService } from '../../../../core/services/confirmation.service';
import { IUser } from '../../../user/models/user';

interface PractitionerOption {
  user: IUser;
  color: string;
  selected: boolean;
}

const PRACTITIONER_COLORS = [
  '#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6',
  '#ec4899', '#06b6d4', '#84cc16', '#f97316', '#6366f1',
];

type CalendarView = 'dayGridMonth' | 'timeGridWeek' | 'timeGridDay' | 'list';
type AppointmentTimeFilter = 'all' | 'upcoming' | 'past';

@Component({
  selector: 'app-appointments',
  imports: [
    CommonModule,
    FormsModule,
    Page,
    Loader,
    Svg,
    Badge,
    Button,
    FullCalendarModule,
    LocalDatePipe,
    TranslatePipe,
    ConfirmPresenceModal,
    AppointmentFormModal,
    ReminderFormModal,
    ReminderCard,
    ElementTypeModal,
    ReminderDetailModal,
  ],
  templateUrl: './appointments.html',
  styleUrl: './appointments.scss',
})
export class Appointments implements OnInit, OnDestroy, AfterViewInit {
  private destroy$ = new Subject<void>();
  private router = inject(Router);
  private route = inject(ActivatedRoute);
  private consultationService = inject(ConsultationService);
  private toasterService = inject(ToasterService);
  private userService = inject(UserService);
  private authService = inject(Auth);
  private el = inject(ElementRef);
  private incomingCallService = inject(IncomingCallService);
  private activeCallService = inject(ActiveCallService);
  private confirmationService = inject(ConfirmationService);
  private t = inject(TranslationService);

  protected readonly getAppointmentBadgeType = getAppointmentBadgeType;
  protected readonly AppointmentType = AppointmentType;
  protected readonly BadgeTypeEnum = BadgeTypeEnum;
  protected readonly ButtonStyleEnum = ButtonStyleEnum;
  protected readonly ButtonSizeEnum = ButtonSizeEnum;

  calendarComponent = viewChild<FullCalendarComponent>('calendar');
  hoveredAppointment = signal<Appointment | null>(null);
  hoveredReminder = signal<{
    title: string;
    description: string;
    recipient: string;
    occurrenceAt: string;
    recurrence: string;
    nextRunAt: string | null;
    recurrenceEndAt: string | null;
  } | null>(null);
  tooltipPosition = signal<{ top: number; left: number }>({ top: 0, left: 0 });
  selectedAppointmentForMenu = signal<Appointment | null>(null);
  menuPosition = signal<{ top: number; left: number }>({ top: 0, left: 0 });

  loading = signal(true);
  loadingMore = signal(false);
  hasMore = signal(false);
  appointments = signal<Appointment[]>([]);
  calendarEvents = signal<EventInput[]>([]);
  private appointmentCalendarEvents: EventInput[] = [];
  private reminderCalendarEvents: EventInput[] = [];
  currentView = signal<CalendarView>('timeGridWeek');
  currentTitle = signal<string>('');

  confirmPresenceModalOpen = signal(false);
  confirmPresenceAppointment = signal<Appointment | null>(null);
  confirmPresenceMyParticipantId = signal<number | null>(null);
  createAppointmentModalOpen = signal(false);
  createReminderModalOpen = signal(false);
  editingReminder = signal<Reminder | null>(null);
  elementTypeModalOpen = signal(false);
  reminderDetailModalOpen = signal(false);
  detailReminder = signal<Reminder | null>(null);

  reminders = signal<Reminder[]>([]);
  isLoadingReminders = signal(false);
  isLoadingMoreReminders = signal(false);
  hasMoreReminders = signal(false);
  private reminderPage = 1;
  private reminderPageSize = 20;
  editingAppointment = signal<Appointment | null>(null);
  selectedStartDate = signal<Date | null>(null);
  selectedEndDate = signal<Date | null>(null);

  highlightedAppointmentId = signal<number | null>(null);

  appointmentTimeFilter = signal<AppointmentTimeFilter>('upcoming');
  tooEarlyError = signal<{ appointmentId: number; time: string; minutes: number } | null>(null);
  appointmentEarlyJoinMinutes = 5; // Default value

  practitioners = signal<PractitionerOption[]>([]);
  practitionerDropdownOpen = signal(false);

  private readonly pageSize = 20;
  private listCurrentPage = 1;
  private currentDateRange: { start: string; end: string } | null = null;

  calendarOptions: CalendarOptions = {
    plugins: [dayGridPlugin, timeGridPlugin, interactionPlugin],
    initialView: 'timeGridWeek',
    headerToolbar: false,
    height: 'auto',
    weekends: true,
    editable: true,
    eventDurationEditable: true,
    selectable: true,
    selectMirror: true,
    dayMaxEvents: true,
    eventClick: this.handleEventClick.bind(this),
    datesSet: this.handleDatesSet.bind(this),
    select: this.handleDateSelect.bind(this),
    eventDrop: this.handleEventDrop.bind(this),
    eventResize: this.handleEventResize.bind(this),
    eventMouseEnter: this.handleEventMouseEnter.bind(this),
    eventMouseLeave: this.handleEventMouseLeave.bind(this),
    slotMinTime: '00:00:00',
    slotMaxTime: '24:00:00',
    allDaySlot: false,
    nowIndicator: true,
    slotDuration: '00:30:00',
    eventTimeFormat: {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    },
    dayHeaderFormat: {
      weekday: 'short',
      day: 'numeric',
    },
    views: {
      dayGridMonth: {
        eventDisplay: 'list-item',
        dayMaxEvents: 4,
        editable: false,
      },
    },
  };

  @HostListener('window:resize')
  onResize(): void {
    this.updateCalendarHeight();
  }

  @HostListener('document:click', ['$event'])
  onDocumentClick(event: MouseEvent): void {
    const target = event.target as HTMLElement;
    const menuElement = this.el.nativeElement.querySelector('.appointment-context-menu');
    if (menuElement && !menuElement.contains(target)) {
      this.closeContextMenu();
    }
    const dropdownEl = this.el.nativeElement.querySelector('.practitioner-selector');
    if (dropdownEl && !dropdownEl.contains(target)) {
      this.practitionerDropdownOpen.set(false);
    }
  }

  ngOnInit(): void {
    this.loadConfig();
    this.loadPractitioners();
    this.refreshReminders();

    this.route.queryParams.pipe(takeUntil(this.destroy$)).subscribe(params => {
      const participantId = params['participantId'];
      const appointmentId = params['appointmentId'];

      if (participantId) {
        this.consultationService.getParticipantById(participantId).pipe(takeUntil(this.destroy$)).subscribe({
          next: (participant) => {
            this.openAppointmentModal(participant.appointment);
          },
        });
        this.router.navigate([], {
          relativeTo: this.route,
          queryParams: {},
          replaceUrl: true,
        });
      }

      if (appointmentId) {
        const join = params['join'] === 'true';
        const id = Number(appointmentId);
        this.highlightedAppointmentId.set(id);
        if (join) {
          this.activeCallService.startCall({ appointmentId: id });
          this.incomingCallService.setActiveCall(id);
        }
        this.setView('list');
        this.router.navigate([], {
          relativeTo: this.route,
          queryParams: {},
          replaceUrl: true,
        });
      }
    });
  }

  loadConfig(): void {
    this.authService.getOpenIDConfig()
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (config) => {
          if (config.appointment_early_join_minutes) {
            this.appointmentEarlyJoinMinutes = config.appointment_early_join_minutes;
          }
        },
        error: () => {
          // Use default value on error
        }
      });
  }

  private loadPractitioners(): void {
    this.userService.searchUsers('', 1, 100, undefined, undefined, true)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: response => {
          const currentUser = this.userService.currentUserValue;
          this.practitioners.set(
            response.results.map((user, index) => ({
              user,
              color: PRACTITIONER_COLORS[index % PRACTITIONER_COLORS.length],
              selected: user.pk === currentUser?.pk,
            }))
          );
          this.loadAppointments();
          if (this.currentView() !== 'list') {
            this.loadReminderOccurrences();
          }
        },
      });
  }

  togglePractitionerDropdown(event: MouseEvent): void {
    event.stopPropagation();
    this.practitionerDropdownOpen.update(v => !v);
  }

  togglePractitioner(practitioner: PractitionerOption): void {
    this.practitioners.update(list =>
      list.map(p =>
        p.user.pk === practitioner.user.pk
          ? { ...p, selected: !p.selected }
          : p
      )
    );
    this.loadAppointments();
    if (this.currentView() !== 'list') {
      this.loadReminderOccurrences();
    }
  }

  getSelectedPractitionerCount(): number {
    return this.practitioners().filter(p => p.selected).length;
  }

  getPractitionerColor(appointment: Appointment): string {
    const practitioner = this.practitioners().find(p =>
      appointment.participants?.some(part => part.user?.id === p.user.pk)
      || appointment.created_by?.id === p.user.pk
    );
    return practitioner?.color || '#3b82f6';
  }

  ngAfterViewInit(): void {
    setTimeout(() => {
      this.updateCalendarHeight();
      this.scrollToNowIndicator();
    });
  }

  private updateCalendarHeight(): void {
    if (this.currentView() === 'list') return;

    const calendarApi = this.calendarComponent()?.getApi();
    if (!calendarApi) return;

    const userContent = this.el.nativeElement.closest(
      '.user-content'
    ) as HTMLElement;
    if (!userContent) return;

    const containerEl = this.el.nativeElement.querySelector(
      '.appointments-container'
    ) as HTMLElement;
    const headerEl = this.el.nativeElement.querySelector(
      '.calendar-header'
    ) as HTMLElement;
    const wrapperEl = this.el.nativeElement.querySelector(
      '.calendar-wrapper'
    ) as HTMLElement;
    if (!containerEl || !headerEl || !wrapperEl) return;

    const contentHeight = userContent.clientHeight;
    const containerStyle = getComputedStyle(containerEl);
    const headerStyle = getComputedStyle(headerEl);
    const wrapperStyle = getComputedStyle(wrapperEl);

    const usedHeight =
      parseFloat(containerStyle.paddingTop) +
      parseFloat(containerStyle.paddingBottom) +
      headerEl.offsetHeight +
      parseFloat(headerStyle.marginBottom) +
      parseFloat(wrapperStyle.paddingTop) +
      parseFloat(wrapperStyle.paddingBottom) +
      parseFloat(wrapperStyle.borderTopWidth) +
      parseFloat(wrapperStyle.borderBottomWidth);

    const availableHeight = contentHeight - usedHeight;
    calendarApi.setOption('height', Math.max(200, availableHeight));
    calendarApi.updateSize();
  }

  private scrollToNowIndicator(): void {
    const indicator = this.el.nativeElement.querySelector(
      '.fc-timegrid-now-indicator-line'
    );
    if (indicator) {
      const scroller = indicator.closest('.fc-scroller');
      if (scroller) {
        const indicatorTop = indicator.offsetTop;
        const scrollerHeight = scroller.clientHeight;
        scroller.scrollTop = indicatorTop - scrollerHeight / 3;
      }
    }
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  loadAppointments(): void {
    if (this.currentView() === 'list') {
      this.loadAllAppointments();
      return;
    }

    if (!this.currentDateRange) {
      return;
    }

    this.loading.set(true);

    const selected = this.practitioners().filter(p => p.selected);

    if (selected.length === 0) {
      this.appointments.set([]);
      this.appointmentCalendarEvents = [];
      this.recomputeCalendarEvents();
      this.loading.set(false);
      return;
    }

    const requests = selected.map(p =>
      this.consultationService.getAppointments({
        page_size: 100,
        status: AppointmentStatus.SCHEDULED,
        scheduled_at__date__gte: this.currentDateRange!.start,
        scheduled_at__date__lte: this.currentDateRange!.end,
        participant_user: p.user.pk,
      })
    );

    forkJoin(requests)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: responses => {
          const allAppointments: Appointment[] = [];
          const allEvents: EventInput[] = [];
          const seenIds = new Set<number>();

          responses.forEach((response, index) => {
            const color = selected[index].color;
            response.results.forEach(appointment => {
              if (!seenIds.has(appointment.id)) {
                seenIds.add(appointment.id);
                allAppointments.push(appointment);
              }
              allEvents.push(...this.transformToCalendarEvents([appointment], color));
            });
          });

          this.appointments.set(allAppointments);
          this.appointmentCalendarEvents = allEvents;
          this.recomputeCalendarEvents();
          this.loading.set(false);
        },
        error: err => {
          this.toasterService.show(
            'error',
            this.t.instant('appointments.errorLoadingAppointments'),
            getErrorMessage(err)
          );
          this.loading.set(false);
        },
      });
  }

  private loadAllAppointments(): void {
    this.loading.set(true);
    this.listCurrentPage = 1;

    const timeFilter = this.appointmentTimeFilter();
    const params: Record<string, unknown> = {
      page_size: this.pageSize,
      status: AppointmentStatus.SCHEDULED,
    };

    if (timeFilter === 'upcoming') {
      params['future'] = true;
    } else if (timeFilter === 'past') {
      params['future'] = false;
    }

    if (this.currentDateRange && !this.highlightedAppointmentId()) {
      params['scheduled_at__date__gte'] = this.currentDateRange.start;
      params['scheduled_at__date__lte'] = this.currentDateRange.end;
    }

    this.consultationService
      .getAppointments(params)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: response => {
          this.appointments.set(response.results);
          this.hasMore.set(!!response.next);
          this.loading.set(false);
          this.scrollToHighlightedAppointment();
        },
        error: err => {
          this.toasterService.show(
            'error',
            this.t.instant('appointments.errorLoadingAppointments'),
            getErrorMessage(err)
          );
          this.loading.set(false);
        },
      });
  }

  private scrollToHighlightedAppointment(): void {
    const id = this.highlightedAppointmentId();
    if (!id) return;

    setTimeout(() => {
      const element = this.el.nativeElement.querySelector('.appointment-item.highlighted');
      if (element) {
        element.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    });
  }

  loadMore(): void {
    if (this.loadingMore() || !this.hasMore()) return;

    this.loadingMore.set(true);
    this.listCurrentPage++;

    const timeFilter = this.appointmentTimeFilter();
    const params: Record<string, unknown> = {
      page_size: this.pageSize,
      page: this.listCurrentPage,
      status: AppointmentStatus.SCHEDULED,
    };

    if (timeFilter === 'upcoming') {
      params['future'] = true;
    } else if (timeFilter === 'past') {
      params['future'] = false;
    }

    if (this.currentDateRange) {
      params['scheduled_at__date__gte'] = this.currentDateRange.start;
      params['scheduled_at__date__lte'] = this.currentDateRange.end;
    }

    this.consultationService
      .getAppointments(params)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: response => {
          this.appointments.update(current => [
            ...current,
            ...response.results,
          ]);
          this.hasMore.set(!!response.next);
          this.loadingMore.set(false);
        },
        error: err => {
          this.toasterService.show(
            'error',
            this.t.instant('appointments.errorLoadingAppointments'),
            getErrorMessage(err)
          );
          this.loadingMore.set(false);
        },
      });
  }

  private transformToCalendarEvents(appointments: Appointment[], color?: string): EventInput[] {
    return appointments.map(appointment => {
      const eventColor = color || this.getPractitionerColor(appointment);
      return {
        id: color ? `${appointment.id}-${color}` : appointment.id.toString(),
        title: this.getEventTitle(appointment),
        start:
          parseDateWithoutTimezone(appointment.scheduled_at) ||
          appointment.scheduled_at,
        end: appointment.end_expected_at
          ? parseDateWithoutTimezone(appointment.end_expected_at) || undefined
          : undefined,
        backgroundColor: eventColor,
        borderColor: eventColor,
        textColor: '#ffffff',
        extendedProps: { appointment },
      };
    });
  }

  private getEventTitle(appointment: Appointment): string {
    const title = appointment.title || this.t.instant('appointments.defaultTitle');
    const type = this.getAppointmentTypeLabel(appointment.type);
    return `${title} (${type})`;
  }

  private readonly reminderEventColor = '#8b5cf6'; // violet, distinct from appointments

  private transformOccurrencesToEvents(
    occurrences: ReminderOccurrence[]
  ): EventInput[] {
    return occurrences.map((occ, i) => {
      const suffix =
        occ.is_recurring && occ.occurrence_total > 1
          ? ` (${occ.occurrence_index + 1}/${occ.occurrence_total})`
          : '';
      const recipient = occ.recipient
        ? `${occ.recipient.first_name || ''} ${occ.recipient.last_name || ''}`.trim() ||
          occ.recipient.email ||
          ''
        : '';
      const recipientPart = recipient ? ` - ${recipient}` : '';
      const recurrence =
        occ.is_recurring && occ.occurrence_total > 1
          ? this.t.instant('reminders.occurrenceLabel', {
              index: String(occ.occurrence_index + 1),
              total: String(occ.occurrence_total),
            })
          : '';
      return {
        id: `reminder-${occ.reminder_id}-${occ.occurrence_index}-${i}`,
        title: `${this.t.instant('reminders.eventPrefix')}: ${occ.title}${recipientPart}${suffix}`,
        start: parseDateWithoutTimezone(occ.occurrence_at) || occ.occurrence_at,
        backgroundColor: this.reminderEventColor,
        borderColor: this.reminderEventColor,
        textColor: '#ffffff',
        extendedProps: {
          reminderId: occ.reminder_id,
          reminderTitle: occ.title,
          reminderDescription: occ.description,
          reminderRecipient: recipient,
          reminderOccurrenceAt: occ.occurrence_at,
          reminderRecurrence: recurrence,
          reminderNextRunAt: occ.next_run_at,
          reminderRecurrenceEndAt: occ.is_recurring ? occ.recurrence_end_at : null,
        },
      };
    });
  }

  private recomputeCalendarEvents(): void {
    this.calendarEvents.set([
      ...this.appointmentCalendarEvents,
      ...this.reminderCalendarEvents,
    ]);
  }

  getAppointmentTypeLabel(type: AppointmentType | string): string {
    const t = typeof type === 'string' ? type.toLowerCase() : type;
    switch (t) {
      case 'online':
      case AppointmentType.ONLINE:
        return this.t.instant('appointments.videoCall');
      case 'inperson':
      case 'in_person':
      case AppointmentType.INPERSON:
        return this.t.instant('appointments.inPerson');
      default:
        return String(type);
    }
  }

  getStatusColor(status: AppointmentStatus | string): string {
    const s = typeof status === 'string' ? status.toLowerCase() : status;
    switch (s) {
      case 'scheduled':
      case AppointmentStatus.SCHEDULED:
        return '#3b82f6';
      case 'cancelled':
      case AppointmentStatus.CANCELLED:
        return '#ef4444';
      case 'completed':
        return '#10b981';
      case 'in_progress':
        return '#f59e0b';
      case 'draft':
      case AppointmentStatus.DRAFT:
        return '#f59e0b';
      default:
        return '#6366f1';
    }
  }

  handleEventClick(clickInfo: EventClickArg): void {
    clickInfo.jsEvent.preventDefault();
    clickInfo.jsEvent.stopPropagation();

    const reminderId = clickInfo.event.extendedProps['reminderId'] as
      | number
      | undefined;
    if (reminderId) {
      // Occurrences only carry the parent id; fetch the full reminder to show.
      this.consultationService
        .getReminder(reminderId)
        .pipe(takeUntil(this.destroy$))
        .subscribe({
          next: reminder => {
            this.detailReminder.set(reminder);
            this.reminderDetailModalOpen.set(true);
          },
          error: error =>
            this.toasterService.show(
              'error',
              this.t.instant('reminders.errorLoading'),
              getErrorMessage(error)
            ),
        });
      return;
    }

    const appointment = clickInfo.event.extendedProps[
      'appointment'
    ] as Appointment;

    this.viewAppointment(appointment);
  }

  handleDatesSet(arg: DatesSetArg): void {
    this.updateTitle();

    const formatDate = (date: Date): string => {
      const year = date.getFullYear();
      const month = String(date.getMonth() + 1).padStart(2, '0');
      const day = String(date.getDate()).padStart(2, '0');
      return `${year}-${month}-${day}`;
    };

    const newStart = formatDate(arg.start);
    const newEnd = formatDate(arg.end);

    if (
      !this.currentDateRange ||
      this.currentDateRange.start !== newStart ||
      this.currentDateRange.end !== newEnd
    ) {
      this.currentDateRange = { start: newStart, end: newEnd };
      this.loadAppointments();
      this.loadReminderOccurrences();
    }
  }

  handleEventMouseEnter(info: EventHoveringArg): void {
    const props = info.event.extendedProps;
    const rect = info.el.getBoundingClientRect();
    const position = {
      top: rect.bottom + window.scrollY + 8,
      left: rect.left + window.scrollX,
    };

    if (props['reminderId']) {
      this.tooltipPosition.set(position);
      this.hoveredReminder.set({
        title: props['reminderTitle'] as string,
        description: props['reminderDescription'] as string,
        recipient: props['reminderRecipient'] as string,
        occurrenceAt: props['reminderOccurrenceAt'] as string,
        recurrence: props['reminderRecurrence'] as string,
        nextRunAt: (props['reminderNextRunAt'] as string | null) ?? null,
        recurrenceEndAt: (props['reminderRecurrenceEndAt'] as string | null) ?? null,
      });
      return;
    }

    const appointment = props['appointment'] as Appointment;
    if (appointment) {
      this.tooltipPosition.set(position);
      this.hoveredAppointment.set(appointment);
    }
  }

  handleEventMouseLeave(): void {
    this.hoveredAppointment.set(null);
    this.hoveredReminder.set(null);
  }

  handleDateSelect(selectInfo: DateSelectArg): void {
    this.selectedStartDate.set(selectInfo.start);
    this.selectedEndDate.set(selectInfo.end);
    // Ask which kind of element to create before opening the relevant form.
    this.elementTypeModalOpen.set(true);
    const calendarApi = selectInfo.view.calendar;
    calendarApi.unselect();
  }

  onElementTypeModalClosed(): void {
    this.elementTypeModalOpen.set(false);
    this.selectedStartDate.set(null);
    this.selectedEndDate.set(null);
  }

  onElementTypeSelected(type: ElementType): void {
    this.elementTypeModalOpen.set(false);
    if (type === 'appointment') {
      this.openCreateAppointmentModal();
    } else {
      this.editingReminder.set(null);
      this.createReminderModalOpen.set(true);
    }
  }

  handleEventDrop(info: EventDropArg): void {
    const reminderId = info.event.extendedProps['reminderId'] as
      | number
      | undefined;
    if (reminderId) {
      this.handleReminderDrop(reminderId, info);
      return;
    }

    const appointment = info.event.extendedProps['appointment'] as Appointment;
    const newStart = info.event.start;
    const newEnd = info.event.end;
    if (!newStart) {
      info.revert();
      return;
    }

    this.updateAppointmentTime(appointment.id, newStart, newEnd, info.revert);
  }

  handleEventResize(info: EventResizeDoneArg): void {
    // Reminders are point-in-time and have no duration: nothing to resize.
    if (info.event.extendedProps['reminderId']) {
      info.revert();
      return;
    }

    const appointment = info.event.extendedProps['appointment'] as Appointment;
    const newStart = info.event.start;
    const newEnd = info.event.end;
    if (!newStart) {
      info.revert();
      return;
    }

    this.updateAppointmentTime(appointment.id, newStart, newEnd, info.revert);
  }

  private handleReminderDrop(reminderId: number, info: EventDropArg): void {
    const newStart = info.event.start;
    const oldStart = info.oldEvent.start;
    if (!newStart || !oldStart) {
      info.revert();
      return;
    }

    // Dragging any occurrence translates the WHOLE series by the same delta.
    // We apply that delta to the reminder's base scheduled_at.
    const deltaMs = newStart.getTime() - oldStart.getTime();

    const formatLocal = (d: Date): string => {
      const year = d.getFullYear();
      const month = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      const hours = String(d.getHours()).padStart(2, '0');
      const minutes = String(d.getMinutes()).padStart(2, '0');
      return `${year}-${month}-${day}T${hours}:${minutes}`;
    };

    this.consultationService
      .getReminder(reminderId)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: reminder => {
          const newScheduled = new Date(
            new Date(reminder.scheduled_at).getTime() + deltaMs
          );
          this.consultationService
            .updateReminder(reminderId, {
              scheduled_at: formatLocal(newScheduled),
            })
            .pipe(takeUntil(this.destroy$))
            .subscribe({
              next: () => this.loadReminderOccurrences(),
              error: err => {
                info.revert();
                this.toasterService.show(
                  'error',
                  this.t.instant('reminders.errorUpdating'),
                  getErrorMessage(err)
                );
              },
            });
        },
        error: err => {
          info.revert();
          this.toasterService.show(
            'error',
            this.t.instant('reminders.errorLoading'),
            getErrorMessage(err)
          );
        },
      });
  }

  private updateAppointmentTime(
    appointmentId: number,
    start: Date,
    end: Date | null,
    revert: () => void,
  ): void {
    const formatLocal = (d: Date): string => {
      const year = d.getFullYear();
      const month = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      const hours = String(d.getHours()).padStart(2, '0');
      const minutes = String(d.getMinutes()).padStart(2, '0');
      return `${year}-${month}-${day}T${hours}:${minutes}`;
    };

    const data: { scheduled_at: string; end_expected_at?: string } = {
      scheduled_at: formatLocal(start),
    };
    if (end) {
      data.end_expected_at = formatLocal(end);
    }

    this.consultationService
      .updateAppointment(appointmentId, data)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: () => {
          this.loadAppointments();
        },
        error: err => {
          revert();
          this.toasterService.show(
            'error',
            this.t.instant('appointments.errorUpdatingAppointment'),
            getErrorMessage(err)
          );
        },
      });
  }

  private updateTitle(): void {
    const calendarApi = this.calendarComponent()?.getApi();
    if (calendarApi) {
      this.currentTitle.set(calendarApi.view.title);
    }
  }

  setView(view: CalendarView): void {
    const previousView = this.currentView();
    this.currentView.set(view);

    if (view === 'list') {
      // Force the hidden calendar back to week view so the date range and title
      // always reflect a week when in list mode
      const calendarApi = this.calendarComponent()?.getApi();
      if (calendarApi && calendarApi.view.type !== 'timeGridWeek') {
        calendarApi.changeView('timeGridWeek');
        // handleDatesSet will fire and call loadAppointments() -> loadAllAppointments()
      } else {
        this.loadAllAppointments();
      }
    } else {
      const calendarApi = this.calendarComponent()?.getApi();
      if (calendarApi) {
        calendarApi.changeView(view);
      }
      if (previousView === 'list') {
        this.loadAppointments();
      }
    }
  }

  isActiveView(view: CalendarView): boolean {
    return this.currentView() === view;
  }

  goToToday(): void {
    const calendarApi = this.calendarComponent()?.getApi();
    if (calendarApi) {
      calendarApi.today();
    }
  }

  navigatePrev(): void {
    const calendarApi = this.calendarComponent()?.getApi();
    if (calendarApi) {
      calendarApi.prev();
    }
  }

  navigateNext(): void {
    const calendarApi = this.calendarComponent()?.getApi();
    if (calendarApi) {
      calendarApi.next();
    }
  }

  viewAppointment(appointment: Appointment): void {
    this.openAppointmentModal(appointment);
  }

  getParticipantName(participant: Participant): string {
    if (participant.user) {
      const firstName = participant.user.first_name || '';
      const lastName = participant.user.last_name || '';
      const fullName = `${firstName} ${lastName}`.trim();
      return (
        fullName ||
        participant.user.email ||
        this.t.instant('appointments.participantUnknown')
      );
    }
    return this.t.instant('appointments.participantUnknown');
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
        return this.t.instant('appointments.participantConfirmed');
      case 'invited':
        return this.t.instant('appointments.participantPending');
      case 'unavailable':
        return this.t.instant('appointments.participantDeclined');
      case 'cancelled':
        return this.t.instant('appointments.participantCancelled');
      case 'draft':
        return this.t.instant('appointments.participantDraft');
      default:
        return this.t.instant('appointments.participantUnknown');
    }
  }

  getAppointmentStatusLabel(status: AppointmentStatus | string): string {
    const s = typeof status === 'string' ? status.toLowerCase() : status;
    switch (s) {
      case 'scheduled':
      case AppointmentStatus.SCHEDULED:
        return this.t.instant('appointments.statusScheduled');
      case 'cancelled':
      case AppointmentStatus.CANCELLED:
        return this.t.instant('appointments.statusCancelled');
      case 'completed':
        return this.t.instant('appointments.statusCompleted');
      case 'in_progress':
        return this.t.instant('appointments.statusInProgress');
      case 'draft':
      case AppointmentStatus.DRAFT:
        return this.t.instant('appointments.statusDraft');
      default:
        return String(status);
    }
  }

  getStatusClass(status: AppointmentStatus | string): string {
    const s = typeof status === 'string' ? status.toLowerCase() : status;
    switch (s) {
      case 'scheduled':
        return 'scheduled';
      case 'cancelled':
        return 'cancelled';
      case 'completed':
        return 'completed';
      case 'in_progress':
        return 'in-progress';
      default:
        return 'scheduled';
    }
  }

  getMyParticipant(appointment: Appointment): Participant | undefined {
    const currentUser = this.userService.currentUserValue;
    if (!currentUser || !appointment.participants) return undefined;
    return appointment.participants.find(p => p.user?.id === currentUser.pk);
  }

  canConfirmPresence(appointment: Appointment): boolean {
    const myParticipant = this.getMyParticipant(appointment);
    return !!myParticipant && myParticipant.status === 'invited';
  }

  openAppointmentModal(appointment: Appointment): void {
    const myParticipant = this.getMyParticipant(appointment);
    this.confirmPresenceAppointment.set(appointment);
    this.confirmPresenceMyParticipantId.set(myParticipant?.id ?? null);
    this.confirmPresenceModalOpen.set(true);
  }

  openConfirmPresenceForAppointment(
    appointment: Appointment,
    event: MouseEvent
  ): void {
    event.stopPropagation();
    this.openAppointmentModal(appointment);
  }

  onConfirmPresenceModalClosed(): void {
    this.confirmPresenceModalOpen.set(false);
    this.confirmPresenceAppointment.set(null);
    this.confirmPresenceMyParticipantId.set(null);
  }

  onPresenceConfirmed(): void {
    this.loadAppointments();
  }

  onEditFromModal(appointmentId: number): void {
    const appointment = this.appointments().find(a => a.id === appointmentId);
    if (appointment) {
      this.editingAppointment.set(appointment);
      this.createAppointmentModalOpen.set(true);
    }
  }

  openCreateAppointmentModal(): void {
    this.createAppointmentModalOpen.set(true);
  }

  openCreateReminderModal(): void {
    this.editingReminder.set(null);
    this.selectedStartDate.set(null);
    this.selectedEndDate.set(null);
    this.createReminderModalOpen.set(true);
  }

  openEditReminderModal(reminder: Reminder): void {
    this.editingReminder.set(reminder);
    this.createReminderModalOpen.set(true);
  }

  onReminderDetailClosed(): void {
    this.reminderDetailModalOpen.set(false);
    this.detailReminder.set(null);
  }

  onReminderDetailEdit(reminder: Reminder): void {
    this.reminderDetailModalOpen.set(false);
    this.detailReminder.set(null);
    this.openEditReminderModal(reminder);
  }

  onReminderDetailDelete(reminder: Reminder): void {
    this.reminderDetailModalOpen.set(false);
    this.detailReminder.set(null);
    this.deleteReminder(reminder);
  }

  onReminderModalClosed(): void {
    this.createReminderModalOpen.set(false);
    this.editingReminder.set(null);
    this.selectedStartDate.set(null);
    this.selectedEndDate.set(null);
  }

  onReminderCreated(): void {
    this.createReminderModalOpen.set(false);
    this.editingReminder.set(null);
    this.selectedStartDate.set(null);
    this.selectedEndDate.set(null);
    this.refreshReminders();
  }

  onReminderUpdated(): void {
    this.createReminderModalOpen.set(false);
    this.editingReminder.set(null);
    this.refreshReminders();
  }

  private buildReminderParams(page: number): {
    page: number;
    page_size: number;
    ordering: string;
    future?: boolean;
    scheduled_at__date__gte?: string;
    scheduled_at__date__lte?: string;
  } {
    const params: {
      page: number;
      page_size: number;
      ordering: string;
      future?: boolean;
      scheduled_at__date__gte?: string;
      scheduled_at__date__lte?: string;
    } = {
      page,
      page_size: this.reminderPageSize,
      ordering: 'scheduled_at',
    };

    const timeFilter = this.appointmentTimeFilter();
    if (timeFilter === 'upcoming') {
      params.future = true;
    } else if (timeFilter === 'past') {
      params.future = false;
    }

    if (this.currentDateRange) {
      params.scheduled_at__date__gte = this.currentDateRange.start;
      params.scheduled_at__date__lte = this.currentDateRange.end;
    }

    return params;
  }

  loadReminders(): void {
    this.isLoadingReminders.set(true);
    this.reminderPage = 1;
    this.consultationService
      .getReminders(this.buildReminderParams(1))
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: response => {
          this.reminders.set(response.results);
          this.hasMoreReminders.set(response.next !== null);
          this.isLoadingReminders.set(false);
        },
        error: error => {
          this.isLoadingReminders.set(false);
          this.toasterService.show(
            'error',
            this.t.instant('reminders.errorLoading'),
            getErrorMessage(error)
          );
        },
      });
  }

  // Refresh both reminder sources relevant to the current view.
  private refreshReminders(): void {
    this.loadReminders();
    if (this.currentView() !== 'list') {
      this.loadReminderOccurrences();
    }
  }

  // Calendar view: load expanded reminder occurrences for the visible range.
  loadReminderOccurrences(): void {
    if (!this.currentDateRange) return;
    // Show reminders created by the selected practitioners (same selection as
    // the appointments). Empty selection -> no reminders.
    const createdByIds = this.practitioners()
      .filter(p => p.selected)
      .map(p => p.user.pk);
    if (createdByIds.length === 0) {
      this.reminderCalendarEvents = [];
      this.recomputeCalendarEvents();
      return;
    }
    this.consultationService
      .getReminderOccurrences(
        this.currentDateRange.start,
        this.currentDateRange.end,
        createdByIds
      )
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: occurrences => {
          this.reminderCalendarEvents =
            this.transformOccurrencesToEvents(occurrences);
          this.recomputeCalendarEvents();
        },
        error: error => {
          this.toasterService.show(
            'error',
            this.t.instant('reminders.errorLoading'),
            getErrorMessage(error)
          );
        },
      });
  }

  loadMoreReminders(): void {
    if (this.isLoadingMoreReminders() || !this.hasMoreReminders()) return;

    this.isLoadingMoreReminders.set(true);
    this.reminderPage++;
    this.consultationService
      .getReminders(this.buildReminderParams(this.reminderPage))
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: response => {
          this.reminders.set([...this.reminders(), ...response.results]);
          this.hasMoreReminders.set(response.next !== null);
          this.isLoadingMoreReminders.set(false);
        },
        error: error => {
          this.reminderPage--;
          this.isLoadingMoreReminders.set(false);
          this.toasterService.show(
            'error',
            this.t.instant('reminders.errorLoading'),
            getErrorMessage(error)
          );
        },
      });
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
          this.reminders.set(this.reminders().filter(r => r.id !== reminder.id));
          if (this.currentView() !== 'list') {
            this.loadReminderOccurrences();
          }
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

  onCreateAppointmentModalClosed(): void {
    this.createAppointmentModalOpen.set(false);
    this.editingAppointment.set(null);
    this.selectedStartDate.set(null);
    this.selectedEndDate.set(null);
  }

  onAppointmentCreated(): void {
    this.createAppointmentModalOpen.set(false);
    this.editingAppointment.set(null);
    this.selectedStartDate.set(null);
    this.selectedEndDate.set(null);
    this.loadAppointments();
  }

  onAppointmentUpdated(): void {
    this.createAppointmentModalOpen.set(false);
    this.editingAppointment.set(null);
    this.selectedStartDate.set(null);
    this.selectedEndDate.set(null);
    this.loadAppointments();
  }

  joinVideoCall(appointment: Appointment, event: MouseEvent): void {
    event.stopPropagation();

    // Check if it's at least X minutes before the scheduled time
    const now = new Date();
    const scheduledTime = new Date(appointment.scheduled_at);
    const earliestJoin = new Date(scheduledTime.getTime() - this.appointmentEarlyJoinMinutes * 60 * 1000);

    if (now < earliestJoin) {
      const scheduledTimeStr = scheduledTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      this.tooEarlyError.set({ appointmentId: appointment.id, time: scheduledTimeStr, minutes: this.appointmentEarlyJoinMinutes });
      setTimeout(() => {
        if (this.tooEarlyError()?.appointmentId === appointment.id) {
          this.tooEarlyError.set(null);
        }
      }, 5000);
      return;
    }

    this.activeCallService.startCall({ appointmentId: appointment.id });
    this.incomingCallService.setActiveCall(appointment.id);
  }

  canJoinVideoCall(appointment: Appointment): boolean {
    return (
      appointment.status === AppointmentStatus.SCHEDULED &&
      appointment.type === AppointmentType.ONLINE
    );
  }

  closeContextMenu(): void {
    this.selectedAppointmentForMenu.set(null);
  }

  editAppointment(appointment: Appointment, event: MouseEvent): void {
    event.stopPropagation();
    this.closeContextMenu();
    this.editingAppointment.set(appointment);
    this.createAppointmentModalOpen.set(true);
  }

  cancelAppointment(appointment: Appointment, event: MouseEvent): void {
    event.stopPropagation();
    this.closeContextMenu();

    if (!confirm(this.t.instant('appointments.confirmCancel'))) {
      return;
    }

    this.consultationService
      .updateAppointment(appointment.id, { status: AppointmentStatus.CANCELLED })
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: () => {
          this.toasterService.show(
            'success',
            this.t.instant('appointments.cancelSuccess')
          );
          this.loadAppointments();
        },
        error: err => {
          this.toasterService.show(
            'error',
            this.t.instant('appointments.cancelError'),
            getErrorMessage(err)
          );
        },
      });
  }

  joinVideoCallFromMenu(appointment: Appointment, event: MouseEvent): void {
    event.stopPropagation();
    this.closeContextMenu();

    // Check if it's at least X minutes before the scheduled time
    const now = new Date();
    const scheduledTime = new Date(appointment.scheduled_at);
    const earliestJoin = new Date(scheduledTime.getTime() - this.appointmentEarlyJoinMinutes * 60 * 1000);

    if (now < earliestJoin) {
      const scheduledTimeStr = scheduledTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      this.tooEarlyError.set({ appointmentId: appointment.id, time: scheduledTimeStr, minutes: this.appointmentEarlyJoinMinutes });
      setTimeout(() => {
        if (this.tooEarlyError()?.appointmentId === appointment.id) {
          this.tooEarlyError.set(null);
        }
      }, 5000);
      return;
    }

    this.activeCallService.startCall({ appointmentId: appointment.id });
    this.incomingCallService.setActiveCall(appointment.id);
  }

  viewConsultationFromMenu(appointment: Appointment, event: MouseEvent): void {
    event.stopPropagation();
    this.closeContextMenu();

    const consultationId =
      appointment.consultation_id || appointment.consultation;
    if (consultationId) {
      this.router.navigate([RoutePaths.USER, 'consultations', consultationId], {
        queryParams: { appointmentId: appointment.id },
      });
    }
  }

  hasConsultation(appointment: Appointment): boolean {
    return !!(appointment.consultation_id || appointment.consultation);
  }

  setAppointmentTimeFilter(filter: AppointmentTimeFilter): void {
    this.appointmentTimeFilter.set(filter);
    this.loadAllAppointments();
    this.loadReminders();
  }
}
