import { Component, OnInit, OnDestroy } from '@angular/core';
import { Router } from '@angular/router';
import { Subject, takeUntil } from 'rxjs';
import { ConsultationService } from '../../core/services/consultation.service';
import { Appointment, AppointmentStatus, AppointmentType } from '../../core/models/consultation';
import { ToasterService } from '../../core/services/toaster.service';
import { Typography } from '../../shared/ui-components/typography/typography';
import { Button } from '../../shared/ui-components/button/button';
import { Svg } from '../../shared/ui-components/svg/svg';
import { Loader } from '../../shared/components/loader/loader';
import { TypographyTypeEnum } from '../../shared/constants/typography';
import { ButtonStyleEnum, ButtonStateEnum } from '../../shared/constants/button';
import { RoutePaths } from '../../core/constants/routes';
import { formatDateFromISO, formatTimeFromISO } from '../../shared/tools/helper';

interface IPendingAppointment {
  id: number;
  scheduled_at: string;
  type: AppointmentType;
  doctorName: string;
  isConfirming: boolean;
  isDeclining: boolean;
}

@Component({
  selector: 'app-confirm-presence',
  standalone: true,
  imports: [
    Typography,
    Button,
    Svg,
    Loader,
  ],
  templateUrl: './confirm-presence.html',
  styleUrl: './confirm-presence.scss',
})
export class ConfirmPresence implements OnInit, OnDestroy {
  private destroy$ = new Subject<void>();

  isLoading = true;
  pendingAppointments: IPendingAppointment[] = [];
  errorMessage: string | null = null;

  protected readonly TypographyTypeEnum = TypographyTypeEnum;
  protected readonly ButtonStyleEnum = ButtonStyleEnum;
  protected readonly ButtonStateEnum = ButtonStateEnum;
  protected readonly AppointmentType = AppointmentType;

  constructor(
    private consultationService: ConsultationService,
    private router: Router,
    private toasterService: ToasterService
  ) {}

  ngOnInit(): void {
    this.loadPendingAppointments();
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  private loadPendingAppointments(): void {
    this.isLoading = true;
    this.errorMessage = null;

    this.consultationService.getAppointments({ status: 'scheduled' })
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (response) => {
          this.isLoading = false;
          const now = new Date();
          this.pendingAppointments = response.results
            .filter(apt => {
              const scheduledDate = new Date(apt.scheduled_at);
              return scheduledDate > now && apt.status === AppointmentStatus.SCHEDULED;
            })
            .map(apt => this.mapAppointment(apt));
        },
        error: () => {
          this.isLoading = false;
          this.errorMessage = 'Failed to load appointments';
        }
      });
  }

  private mapAppointment(apt: Appointment): IPendingAppointment {
    const createdBy = apt.created_by;
    const doctorName = createdBy
      ? `${createdBy.first_name || ''} ${createdBy.last_name || ''}`.trim() || 'Healthcare Provider'
      : 'Healthcare Provider';

    return {
      id: apt.id,
      scheduled_at: apt.scheduled_at,
      type: apt.type,
      doctorName,
      isConfirming: false,
      isDeclining: false
    };
  }

  confirmPresence(appointment: IPendingAppointment): void {
    appointment.isConfirming = true;

    this.consultationService.confirmAppointmentPresence(appointment.id, true)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: () => {
          appointment.isConfirming = false;
          this.pendingAppointments = this.pendingAppointments.filter(a => a.id !== appointment.id);
          this.toasterService.show('success', 'Presence confirmed successfully');
          this.checkAllConfirmed();
        },
        error: () => {
          appointment.isConfirming = false;
          this.toasterService.show('error', 'Failed to confirm presence');
        }
      });
  }

  declinePresence(appointment: IPendingAppointment): void {
    appointment.isDeclining = true;

    this.consultationService.confirmAppointmentPresence(appointment.id, false)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: () => {
          appointment.isDeclining = false;
          this.pendingAppointments = this.pendingAppointments.filter(a => a.id !== appointment.id);
          this.toasterService.show('warning', 'You have declined the appointment');
          this.checkAllConfirmed();
        },
        error: () => {
          appointment.isDeclining = false;
          this.toasterService.show('error', 'Failed to decline');
        }
      });
  }

  private checkAllConfirmed(): void {
    if (this.pendingAppointments.length === 0) {
      setTimeout(() => {
        this.goToHome();
      }, 1500);
    }
  }

  goToHome(): void {
    this.router.navigateByUrl(`/${RoutePaths.USER}/${RoutePaths.DASHBOARD}`);
  }

  formatDate(dateString: string): string {
    return formatDateFromISO(dateString);
  }

  formatTime(dateString: string): string {
    return formatTimeFromISO(dateString);
  }
}
