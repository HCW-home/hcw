import { Component, OnInit, OnDestroy, signal, inject, viewChild, HostListener } from '@angular/core';
import { Router } from '@angular/router';
import { CommonModule, DatePipe } from '@angular/common';
import { Subject, takeUntil } from 'rxjs';
import { FullCalendarModule, FullCalendarComponent } from '@fullcalendar/angular';
import { CalendarOptions, EventInput, EventClickArg, EventHoveringArg, DatesSetArg } from '@fullcalendar/core';
import dayGridPlugin from '@fullcalendar/daygrid';
import timeGridPlugin from '@fullcalendar/timegrid';
import interactionPlugin from '@fullcalendar/interaction';
import { Page } from '../../../../core/components/page/page';
import { Loader } from '../../../../shared/components/loader/loader';
import { Badge } from '../../../../shared/components/badge/badge';
import { Svg } from '../../../../shared/ui-components/svg/svg';
import { Button } from '../../../../shared/ui-components/button/button';
import { ButtonStyleEnum, ButtonSizeEnum } from '../../../../shared/constants/button';
import { ConsultationService } from '../../../../core/services/consultation.service';
import { ToasterService } from '../../../../core/services/toaster.service';
import { Appointment, AppointmentStatus, AppointmentType, Participant, ParticipantStatus } from '../../../../core/models/consultation';
import { RoutePaths } from '../../../../core/constants/routes';
import { getAppointmentBadgeType } from '../../../../shared/tools/helper';
import { getErrorMessage } from '../../../../core/utils/error-helper';
import { LocalDatePipe } from '../../../../shared/pipes/local-date.pipe';

type CalendarView = 'dayGridMonth' | 'timeGridWeek' | 'timeGridDay' | 'list';

@Component({
  selector: 'app-appointments',
  imports: [CommonModule, DatePipe, Page, Loader, Svg, Badge, Button, FullCalendarModule, LocalDatePipe],
  templateUrl: './appointments.html',
  styleUrl: './appointments.scss',
})
export class Appointments implements OnInit, OnDestroy {
  private destroy$ = new Subject<void>();
  private router = inject(Router);
  private consultationService = inject(ConsultationService);
  private toasterService = inject(ToasterService);

  protected readonly getAppointmentBadgeType = getAppointmentBadgeType;
  protected readonly AppointmentType = AppointmentType;
  protected readonly ButtonStyleEnum = ButtonStyleEnum;
  protected readonly ButtonSizeEnum = ButtonSizeEnum;

  calendarComponent = viewChild<FullCalendarComponent>('calendar');
  hoveredAppointment = signal<Appointment | null>(null);
  tooltipPosition = signal<{ top: number; left: number }>({ top: 0, left: 0 });

  loading = signal(true);
  loadingMore = signal(false);
  hasMore = signal(false);
  appointments = signal<Appointment[]>([]);
  calendarEvents = signal<EventInput[]>([]);
  currentView = signal<CalendarView>('timeGridWeek');
  currentTitle = signal<string>('');

  private readonly pageSize = 20;
  private listCurrentPage = 1;
  private currentDateRange: { start: string; end: string } | null = null;

  calendarOptions: CalendarOptions = {
    plugins: [dayGridPlugin, timeGridPlugin, interactionPlugin],
    initialView: 'timeGridWeek',
    headerToolbar: false,
    height: 'auto',
    weekends: true,
    editable: false,
    selectable: false,
    selectMirror: false,
    dayMaxEvents: true,
    eventClick: this.handleEventClick.bind(this),
    datesSet: this.handleDatesSet.bind(this),
    eventMouseEnter: this.handleEventMouseEnter.bind(this),
    eventMouseLeave: this.handleEventMouseLeave.bind(this),
    slotMinTime: '06:00:00',
    slotMaxTime: '22:00:00',
    allDaySlot: false,
    nowIndicator: true,
    slotDuration: '00:30:00',
    eventTimeFormat: {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false
    },
    dayHeaderFormat: {
      weekday: 'short',
      day: 'numeric'
    }
  };

  @HostListener('window:resize')
  onResize(): void {
    const calendarApi = this.calendarComponent()?.getApi();
    if (calendarApi) {
      calendarApi.updateSize();
    }
  }

  ngOnInit(): void {
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

    this.consultationService
      .getAppointments({
        page_size: 100,
        status: AppointmentStatus.SCHEDULED,
        scheduled_at__date__gte: this.currentDateRange.start,
        scheduled_at__date__lte: this.currentDateRange.end,
      })
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: response => {
          this.appointments.set(response.results);
          this.calendarEvents.set(this.transformToCalendarEvents(response.results));
          this.loading.set(false);
        },
        error: (err) => {
          this.toasterService.show('error', 'Error', getErrorMessage(err));
          this.loading.set(false);
        }
      });
  }

  private loadAllAppointments(): void {
    this.loading.set(true);
    this.listCurrentPage = 1;

    this.consultationService
      .getAppointments({ page_size: this.pageSize, status: AppointmentStatus.SCHEDULED })
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: response => {
          this.appointments.set(response.results);
          this.hasMore.set(!!response.next);
          this.loading.set(false);
        },
        error: (err) => {
          this.toasterService.show('error', 'Error', getErrorMessage(err));
          this.loading.set(false);
        }
      });
  }

  loadMore(): void {
    if (this.loadingMore() || !this.hasMore()) return;

    this.loadingMore.set(true);
    this.listCurrentPage++;

    this.consultationService
      .getAppointments({ page_size: this.pageSize, page: this.listCurrentPage, status: AppointmentStatus.SCHEDULED })
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: response => {
          this.appointments.update(current => [...current, ...response.results]);
          this.hasMore.set(!!response.next);
          this.loadingMore.set(false);
        },
        error: (err) => {
          this.toasterService.show('error', 'Error', getErrorMessage(err));
          this.loadingMore.set(false);
        }
      });
  }

  private transformToCalendarEvents(appointments: Appointment[]): EventInput[] {
    return appointments.map(appointment => ({
      id: appointment.id.toString(),
      title: this.getEventTitle(appointment),
      start: appointment.scheduled_at,
      end: appointment.end_expected_at || undefined,
      backgroundColor: this.getStatusColor(appointment.status),
      borderColor: this.getStatusColor(appointment.status),
      textColor: '#ffffff',
      extendedProps: { appointment }
    }));
  }

  private getEventTitle(appointment: Appointment): string {
    return this.getAppointmentTypeLabel(appointment.type);
  }

  getAppointmentTypeLabel(type: AppointmentType | string): string {
    const t = typeof type === 'string' ? type.toLowerCase() : type;
    switch (t) {
      case 'online':
      case AppointmentType.ONLINE:
        return 'Video Call';
      case 'inperson':
      case 'in_person':
      case AppointmentType.INPERSON:
        return 'In Person';
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
    const appointment = clickInfo.event.extendedProps['appointment'] as Appointment;
    const consultationId = appointment?.consultation_id || appointment?.consultation;
    if (consultationId) {
      this.router.navigate([RoutePaths.USER, 'consultations', consultationId], {
        queryParams: { appointmentId: appointment.id }
      });
    }
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

    if (!this.currentDateRange ||
        this.currentDateRange.start !== newStart ||
        this.currentDateRange.end !== newEnd) {
      this.currentDateRange = { start: newStart, end: newEnd };
      this.loadAppointments();
    }
  }

  handleEventMouseEnter(info: EventHoveringArg): void {
    const appointment = info.event.extendedProps['appointment'] as Appointment;
    if (appointment) {
      const rect = info.el.getBoundingClientRect();
      this.tooltipPosition.set({
        top: rect.bottom + window.scrollY + 8,
        left: rect.left + window.scrollX
      });
      this.hoveredAppointment.set(appointment);
    }
  }

  handleEventMouseLeave(): void {
    this.hoveredAppointment.set(null);
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
      this.loadAllAppointments();
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
    const consultationId = appointment.consultation_id || appointment.consultation;
    if (consultationId) {
      this.router.navigate([RoutePaths.USER, 'consultations', consultationId], {
        queryParams: { appointmentId: appointment.id }
      });
    }
  }

  getParticipantName(participant: Participant): string {
    if (participant.user) {
      const firstName = participant.user.first_name || '';
      const lastName = participant.user.last_name || '';
      const fullName = `${firstName} ${lastName}`.trim();
      return fullName || participant.user.email || 'Unknown';
    }
    return 'Unknown';
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
        return 'Confirmed';
      case 'invited':
        return 'Pending';
      case 'unavailable':
        return 'Declined';
      case 'cancelled':
        return 'Cancelled';
      case 'draft':
        return 'Draft';
      default:
        return 'Unknown';
    }
  }

  getAppointmentStatusLabel(status: AppointmentStatus | string): string {
    const s = typeof status === 'string' ? status.toLowerCase() : status;
    switch (s) {
      case 'scheduled':
      case AppointmentStatus.SCHEDULED:
        return 'Scheduled';
      case 'cancelled':
      case AppointmentStatus.CANCELLED:
        return 'Cancelled';
      case 'completed':
        return 'Completed';
      case 'in_progress':
        return 'In Progress';
      case 'draft':
      case AppointmentStatus.DRAFT:
        return 'Draft';
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

}
