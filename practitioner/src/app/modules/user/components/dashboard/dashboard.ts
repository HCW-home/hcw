import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { forkJoin } from 'rxjs';
import { Page } from '../../../../core/components/page/page';
import { Typography } from '../../../../shared/ui-components/typography/typography';
import { Button } from '../../../../shared/ui-components/button/button';
import { Svg } from '../../../../shared/ui-components/svg/svg';
import { Badge } from '../../../../shared/components/badge/badge';
import { Loader } from '../../../../shared/components/loader/loader';
import { TypographyTypeEnum } from '../../../../shared/constants/typography';
import { ButtonSizeEnum, ButtonStyleEnum } from '../../../../shared/constants/button';
import { BadgeTypeEnum } from '../../../../shared/constants/badge';
import { ConsultationService } from '../../../../core/services/consultation.service';
import { ToasterService } from '../../../../core/services/toaster.service';
import { Consultation, Appointment, AppointmentStatus } from '../../../../core/models/consultation';

interface DashboardStats {
  totalConsultations: number;
  activeConsultations: number;
  closedConsultations: number;
}

interface StatCard {
  title: string;
  value: number;
  icon: string;
  color: string;
  bgColor: string;
}

@Component({
  selector: 'app-dashboard',
  imports: [
    CommonModule,
    Page,
    Typography,
    Button,
    Svg,
    Badge,
    Loader
  ],
  templateUrl: './dashboard.html',
  styleUrl: './dashboard.scss',
})
export class Dashboard implements OnInit {
  private consultationService = inject(ConsultationService);
  private toasterService = inject(ToasterService);
  private router = inject(Router);

  loading = signal(true);
  error = signal<string | null>(null);

  stats = signal<DashboardStats>({
    totalConsultations: 0,
    activeConsultations: 0,
    closedConsultations: 0
  });

  recentConsultations = signal<Consultation[]>([]);
  upcomingAppointments = signal<{ appointment: Appointment; consultation: Consultation }[]>([]);

  protected readonly TypographyTypeEnum = TypographyTypeEnum;
  protected readonly ButtonSizeEnum = ButtonSizeEnum;
  protected readonly ButtonStyleEnum = ButtonStyleEnum;
  protected readonly BadgeTypeEnum = BadgeTypeEnum;

  get statCards(): StatCard[] {
    const s = this.stats();
    return [
      {
        title: 'Total Consultations',
        value: s.totalConsultations,
        icon: 'report',
        color: 'var(--Primary-05)',
        bgColor: 'var(--Primary-01)'
      },
      {
        title: 'Active',
        value: s.activeConsultations,
        icon: 'activity-history',
        color: 'var(--Success-05)',
        bgColor: 'var(--Success-01)'
      },
      {
        title: 'Closed',
        value: s.closedConsultations,
        icon: 'check',
        color: 'var(--Bluish-Gray-06)',
        bgColor: 'var(--Bluish-Gray-02)'
      }
    ];
  }

  ngOnInit(): void {
    this.loadDashboardData();
  }

  loadDashboardData(): void {
    this.loading.set(true);
    this.error.set(null);

    forkJoin({
      activeConsultations: this.consultationService.getConsultations({ is_closed: false, page_size: 100 }),
      closedConsultations: this.consultationService.getConsultations({ is_closed: true, page_size: 100 })
    }).subscribe({
      next: (data) => {
        const activeCount = data.activeConsultations.count;
        const closedCount = data.closedConsultations.count;

        this.stats.set({
          totalConsultations: activeCount + closedCount,
          activeConsultations: activeCount,
          closedConsultations: closedCount
        });

        this.recentConsultations.set(data.activeConsultations.results.slice(0, 5));
        this.loadUpcomingAppointments(data.activeConsultations.results);
        this.loading.set(false);
      },
      error: () => {
        this.error.set('Failed to load dashboard data');
        this.toasterService.show('error', 'Error', 'Failed to load dashboard data');
        this.loading.set(false);
      }
    });
  }

  private loadUpcomingAppointments(consultations: Consultation[]): void {
    const upcoming: { appointment: Appointment; consultation: Consultation }[] = [];
    let processed = 0;
    const toProcess = Math.min(consultations.length, 10);

    if (toProcess === 0) {
      this.upcomingAppointments.set([]);
      return;
    }

    consultations.slice(0, 10).forEach(consultation => {
      this.consultationService.getConsultationAppointments(consultation.id, { page_size: 5 })
        .subscribe({
          next: (appointmentsData) => {
            const now = new Date();
            appointmentsData.results
              .filter(apt => apt.status === AppointmentStatus.SCHEDULED && new Date(apt.scheduled_at) > now)
              .forEach(apt => {
                upcoming.push({ appointment: apt, consultation });
              });

            processed++;
            if (processed === toProcess) {
              upcoming.sort((a, b) =>
                new Date(a.appointment.scheduled_at).getTime() - new Date(b.appointment.scheduled_at).getTime()
              );
              this.upcomingAppointments.set(upcoming.slice(0, 5));
            }
          },
          error: () => {
            processed++;
            if (processed === toProcess) {
              upcoming.sort((a, b) =>
                new Date(a.appointment.scheduled_at).getTime() - new Date(b.appointment.scheduled_at).getTime()
              );
              this.upcomingAppointments.set(upcoming.slice(0, 5));
            }
          }
        });
    });
  }

  formatDate(dateStr: string): string {
    const date = new Date(dateStr);
    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric'
    });
  }

  formatDateTime(dateStr: string): string {
    const date = new Date(dateStr);
    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
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

  getBeneficiaryName(consultation: Consultation): string {
    if (consultation.beneficiary) {
      return `${consultation.beneficiary.first_name} ${consultation.beneficiary.last_name}`;
    }
    return 'Unassigned';
  }

  navigateToConsultations(): void {
    this.router.navigate(['/consultations']);
  }

  navigateToNewConsultation(): void {
    this.router.navigate(['/consultations/new']);
  }

  navigateToAvailability(): void {
    this.router.navigate(['/availability']);
  }

  navigateToSystemTest(): void {
    this.router.navigate(['/system-test']);
  }

  viewConsultation(consultation: Consultation): void {
    this.router.navigate(['/consultations', consultation.id]);
  }

  viewAppointment(item: { appointment: Appointment; consultation: Consultation }): void {
    this.router.navigate(['/consultations', item.consultation.id]);
  }

  retry(): void {
    this.loadDashboardData();
  }
}
