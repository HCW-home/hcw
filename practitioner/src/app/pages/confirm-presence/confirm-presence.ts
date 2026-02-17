import { Component, OnInit, OnDestroy } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { Subject, takeUntil } from 'rxjs';
import { TranslatePipe } from '@ngx-translate/core';
import { ConsultationService } from '../../core/services/consultation.service';
import {  AppointmentType, IParticipantDetail } from '../../core/models/consultation';
import { ToasterService } from '../../core/services/toaster.service';
import { TranslationService } from '../../core/services/translation.service';
import { Typography } from '../../shared/ui-components/typography/typography';
import { Button } from '../../shared/ui-components/button/button';
import { Svg } from '../../shared/ui-components/svg/svg';
import { Loader } from '../../shared/components/loader/loader';
import { TypographyTypeEnum } from '../../shared/constants/typography';
import { ButtonStyleEnum, ButtonStateEnum, ButtonSizeEnum } from '../../shared/constants/button';
import { RoutePaths } from '../../core/constants/routes';
import { LocalDatePipe } from '../../shared/pipes/local-date.pipe';

interface IPendingAppointment {
  id: number;
  participantId: number;
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
    LocalDatePipe,
    TranslatePipe,
  ],
  templateUrl: './confirm-presence.html',
  styleUrl: './confirm-presence.scss',
})
export class ConfirmPresence implements OnInit, OnDestroy {
  private destroy$ = new Subject<void>();

  isLoading = true;
  pendingAppointments: IPendingAppointment[] = [];
  errorMessage: string | null = null;
  participantId: string;

  protected readonly TypographyTypeEnum = TypographyTypeEnum;
  protected readonly ButtonStyleEnum = ButtonStyleEnum;
  protected readonly ButtonStateEnum = ButtonStateEnum;
  protected readonly AppointmentType = AppointmentType;

  constructor(
    private route: ActivatedRoute,
    private consultationService: ConsultationService,
    private router: Router,
    private toasterService: ToasterService,
    private t: TranslationService
  ) {
    this.participantId = this.route.snapshot.paramMap.get('id') as string;
  }

  ngOnInit(): void {
    if (this.participantId) {
      this.loadParticipant();
    } else {
      this.isLoading = false;
      this.errorMessage = this.t.instant('confirmPresence.invalidLink');
    }
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  private loadParticipant(): void {
    this.isLoading = true;
    this.errorMessage = null;

    this.consultationService.getParticipantById(this.participantId)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (participant) => {
          this.isLoading = false;
          const appointment = participant.appointment;
          if (appointment) {
            this.pendingAppointments = [this.mapParticipant(participant)];
          } else {
            this.pendingAppointments = [];
            this.errorMessage = this.t.instant('confirmPresence.noLongerPending');
          }
        },
        error: () => {
          this.isLoading = false;
          this.errorMessage = this.t.instant('confirmPresence.loadError');
        }
      });
  }

  private mapParticipant(participant: IParticipantDetail): IPendingAppointment {
    const apt = participant.appointment;
    const createdBy = apt.created_by;
    const doctorName = createdBy
      ? `${createdBy.first_name || ''} ${createdBy.last_name || ''}`.trim() : '';

    return {
      id: apt.id,
      participantId: participant.id,
      scheduled_at: apt.scheduled_at,
      type: apt.type,
      doctorName,
      isConfirming: false,
      isDeclining: false
    };
  }

  confirmPresence(appointment: IPendingAppointment): void {
    appointment.isConfirming = true;

    this.consultationService.confirmParticipantPresence(this.participantId, true)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: () => {
          appointment.isConfirming = false;
          this.pendingAppointments = this.pendingAppointments.filter(a => a.id !== appointment.id);
          this.toasterService.show('success', this.t.instant('confirmPresence.confirmSuccess'), this.t.instant('confirmPresence.confirmSuccessMessage'));
          this.checkAllConfirmed();
        },
        error: () => {
          appointment.isConfirming = false;
          this.toasterService.show('error', this.t.instant('confirmPresence.confirmError'), this.t.instant('confirmPresence.confirmErrorMessage'));
        }
      });
  }

  declinePresence(appointment: IPendingAppointment): void {
    appointment.isDeclining = true;

    this.consultationService.confirmParticipantPresence(this.participantId, false)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: () => {
          appointment.isDeclining = false;
          this.pendingAppointments = this.pendingAppointments.filter(a => a.id !== appointment.id);
          this.toasterService.show('warning', this.t.instant('confirmPresence.declineSuccess'), this.t.instant('confirmPresence.declineSuccessMessage'));
          this.checkAllConfirmed();
        },
        error: () => {
          appointment.isDeclining = false;
          this.toasterService.show('error', this.t.instant('confirmPresence.declineError'), this.t.instant('confirmPresence.declineErrorMessage'));
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

  protected readonly ButtonSizeEnum = ButtonSizeEnum;
}
