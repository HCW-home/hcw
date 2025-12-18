import { Component, OnInit, OnDestroy, signal, inject, viewChild, HostListener } from '@angular/core';
import { Router } from '@angular/router';
import { CommonModule } from '@angular/common';
import { Subject, takeUntil } from 'rxjs';
import { FullCalendarModule, FullCalendarComponent } from '@fullcalendar/angular';
import { CalendarOptions, EventInput, EventClickArg } from '@fullcalendar/core';
import dayGridPlugin from '@fullcalendar/daygrid';
import timeGridPlugin from '@fullcalendar/timegrid';
import interactionPlugin from '@fullcalendar/interaction';
import { Page } from '../../../../core/components/page/page';
import { Loader } from '../../../../shared/components/loader/loader';
import { ConsultationService } from '../../../../core/services/consultation.service';
import { ToasterService } from '../../../../core/services/toaster.service';
import { Appointment, AppointmentStatus, AppointmentType } from '../../../../core/models/consultation';
import { RoutePaths } from '../../../../core/constants/routes';

type CalendarView = 'dayGridMonth' | 'timeGridWeek' | 'timeGridDay';

@Component({
  selector: 'app-appointments',
  imports: [CommonModule, Page, Loader, FullCalendarModule],
  templateUrl: './appointments.html',
  styleUrl: './appointments.scss',
})
export class Appointments implements OnInit, OnDestroy {
  private destroy$ = new Subject<void>();
  private router = inject(Router);
  private consultationService = inject(ConsultationService);
  private toasterService = inject(ToasterService);

  calendarComponent = viewChild<FullCalendarComponent>('calendar');

  loading = signal(true);
  appointments = signal<Appointment[]>([]);
  calendarEvents = signal<EventInput[]>([]);
  currentView = signal<CalendarView>('timeGridWeek');
  currentTitle = signal<string>('');

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
    this.loadAppointments();
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  loadAppointments(): void {
    this.loading.set(true);
    this.consultationService
      .getAppointments({ page_size: 100 })
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: response => {
          this.appointments.set(response.results);
          this.calendarEvents.set(this.transformToCalendarEvents(response.results));
          this.loading.set(false);
        },
        error: () => {
          this.toasterService.show('error', 'Error', 'Failed to load appointments');
          this.loading.set(false);
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

  private getAppointmentTypeLabel(type: AppointmentType | string): string {
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

  private getStatusColor(status: AppointmentStatus | string): string {
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
      default:
        return '#6366f1';
    }
  }

  handleEventClick(clickInfo: EventClickArg): void {
    const appointment = clickInfo.event.extendedProps['appointment'] as Appointment;
    if (appointment?.consultation) {
      this.router.navigate([RoutePaths.USER, 'consultations', appointment.consultation]);
    }
  }

  handleDatesSet(): void {
    this.updateTitle();
  }

  private updateTitle(): void {
    const calendarApi = this.calendarComponent()?.getApi();
    if (calendarApi) {
      this.currentTitle.set(calendarApi.view.title);
    }
  }

  setView(view: CalendarView): void {
    this.currentView.set(view);
    const calendarApi = this.calendarComponent()?.getApi();
    if (calendarApi) {
      calendarApi.changeView(view);
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
}
