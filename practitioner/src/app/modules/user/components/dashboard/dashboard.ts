import { Component, OnInit, OnDestroy, inject, signal } from '@angular/core';
import { CommonModule, DatePipe } from '@angular/common';
import { Router } from '@angular/router';
import { Subject, takeUntil } from 'rxjs';
import { Page } from '../../../../core/components/page/page';
import { Typography } from '../../../../shared/ui-components/typography/typography';
import { Button } from '../../../../shared/ui-components/button/button';
import { Svg } from '../../../../shared/ui-components/svg/svg';
import { Loader } from '../../../../shared/components/loader/loader';
import { Badge } from '../../../../shared/components/badge/badge';
import { TypographyTypeEnum } from '../../../../shared/constants/typography';
import { ButtonSizeEnum, ButtonStyleEnum } from '../../../../shared/constants/button';
import { ConsultationService } from '../../../../core/services/consultation.service';
import { ToasterService } from '../../../../core/services/toaster.service';
import { Consultation, Appointment, DashboardNextAppointment, AppointmentType, AppointmentStatus } from '../../../../core/models/consultation';
import { getErrorMessage } from '../../../../core/utils/error-helper';
import { getAppointmentBadgeType } from '../../../../shared/tools/helper';

@Component({
  selector: 'app-dashboard',
  imports: [
    CommonModule,
    Page,
    Typography,
    Button,
    Svg,
    Loader,
    Badge
  ],
  providers: [DatePipe],
  templateUrl: './dashboard.html',
  styleUrl: './dashboard.scss',
})
export class Dashboard implements OnInit, OnDestroy {
  private consultationService = inject(ConsultationService);
  private toasterService = inject(ToasterService);
  private router = inject(Router);
  private datePipe = inject(DatePipe);
  private destroy$ = new Subject<void>();

  loading = signal(true);
  error = signal<string | null>(null);

  nextAppointment = signal<DashboardNextAppointment | null>(null);
  upcomingAppointments = signal<Appointment[]>([]);
  overdueConsultations = signal<Consultation[]>([]);

  protected readonly getAppointmentBadgeType = getAppointmentBadgeType;

  hasValidNextAppointment(): boolean {
    const apt = this.nextAppointment();
    return apt !== null && apt.scheduled_at !== null && apt.consultation_id !== null;
  }

  protected readonly TypographyTypeEnum = TypographyTypeEnum;
  protected readonly ButtonSizeEnum = ButtonSizeEnum;
  protected readonly ButtonStyleEnum = ButtonStyleEnum;
  protected readonly AppointmentType = AppointmentType;

  ngOnInit(): void {
    this.loadDashboardData();
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  loadDashboardData(): void {
    this.loading.set(true);
    this.error.set(null);

    this.consultationService.getDashboard()
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (data) => {
          this.nextAppointment.set(data.next_appointment);
          this.upcomingAppointments.set(data.upcoming_appointments || []);
          this.overdueConsultations.set(data.overdue_consultations || []);
          this.loading.set(false);
        },
        error: (err) => {
          this.error.set('Failed to load dashboard data');
          this.toasterService.show('error', getErrorMessage(err));
          this.loading.set(false);
        }
      });
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

  formatDate(dateStr: string): string {
    return this.datePipe.transform(dateStr, 'MMM d, yyyy') || '';
  }

  formatDateTime(dateStr: string): string {
    return this.datePipe.transform(dateStr, 'MMM d, h:mm a') || '';
  }

  formatTime(dateStr: string): string {
    return this.datePipe.transform(dateStr, 'h:mm a') || '';
  }

  getRelativeTime(dateStr: string): string {
    const date = new Date(dateStr);
    const now = new Date();
    const diffMs = date.getTime() - now.getTime();
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

    if (diffDays > 0) {
      return diffDays === 1 ? 'Tomorrow' : `In ${diffDays} days`;
    } else if (diffHours > 0) {
      return `In ${diffHours} hours`;
    } else {
      return 'Soon';
    }
  }

  getWaitingTime(consultation: Consultation): string {
    const updatedAt = new Date(consultation.updated_at);
    const now = new Date();
    const diffMs = now.getTime() - updatedAt.getTime();
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

    if (diffDays === 1) {
      return '1 day';
    } else if (diffDays > 1) {
      return `${diffDays} days`;
    } else {
      const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
      return diffHours === 1 ? '1 hour' : `${diffHours} hours`;
    }
  }

  getBeneficiaryName(consultation: Consultation): string {
    if (consultation.beneficiary) {
      return `${consultation.beneficiary.first_name || ''} ${consultation.beneficiary.last_name || ''}`.trim() || consultation.beneficiary.email;
    }
    return 'Unassigned';
  }

  getConsultationInitials(consultation: Consultation): string {
    if (consultation.beneficiary) {
      const first = consultation.beneficiary.first_name?.charAt(0) || '';
      const last = consultation.beneficiary.last_name?.charAt(0) || '';
      return (first + last).toUpperCase() || consultation.beneficiary.email.charAt(0).toUpperCase();
    }
    return '--';
  }

  navigateToConsultations(): void {
    this.router.navigate(['/app/consultations']);
  }

  navigateToNewConsultation(): void {
    this.router.navigate(['/app/consultations/new']);
  }

  navigateToAvailability(): void {
    this.router.navigate(['/app/configuration'], { fragment: 'availability' });
  }

  navigateToSystemTest(): void {
    this.router.navigate(['/app/configuration'], { fragment: 'system-test' });
  }

  viewConsultation(consultation: Consultation): void {
    this.router.navigate(['/app/consultations', consultation.id]);
  }

  viewAppointment(appointment: Appointment): void {
    this.router.navigate(['/app/consultations', appointment.consultation_id], {
      queryParams: { appointmentId: appointment.id }
    });
  }

  joinNextAppointment(event: Event): void {
    event.stopPropagation();
    const apt = this.nextAppointment();
    if (apt && apt.id && apt.consultation_id) {
      this.router.navigate(['/app/consultations', apt.consultation_id], {
        queryParams: { join: true, appointmentId: apt.id }
      });
    }
  }

  viewNextAppointment(): void {
    const apt = this.nextAppointment();
    if (apt && apt.consultation_id) {
      this.router.navigate(['/app/consultations', apt.consultation_id], {
        queryParams: { appointmentId: apt.id }
      });
    }
  }

  retry(): void {
    this.loadDashboardData();
  }
}
