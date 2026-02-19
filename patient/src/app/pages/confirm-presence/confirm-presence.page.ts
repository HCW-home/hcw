import { Component, OnInit, OnDestroy, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute } from '@angular/router';
import {
  IonContent,
  IonCard,
  IonCardContent,
  IonIcon,
  IonText,
  IonButton,
  IonSpinner,
  NavController,
  ToastController
} from '@ionic/angular/standalone';
import { TranslatePipe } from '@ngx-translate/core';
import { Subject, takeUntil } from 'rxjs';
import { ConsultationService } from '../../core/services/consultation.service';
import { TranslationService } from '../../core/services/translation.service';
import { IParticipantDetail } from '../../core/models/consultation.model';
import { formatDateFromISO, formatTimeFromISO } from '../../core/utils/date-helper';
import { LocalDatePipe } from '../../shared/pipes/local-date.pipe';
import { AppHeaderComponent } from '../../shared/app-header/app-header.component';
import { AppFooterComponent } from '../../shared/app-footer/app-footer.component';

interface PendingAppointment {
  id: number;
  participantId: number;
  scheduled_at: string;
  type: string;
  doctorName: string;
  isConfirming: boolean;
  isDeclining: boolean;
}

@Component({
  selector: 'app-confirm-presence',
  templateUrl: './confirm-presence.page.html',
  styleUrls: ['./confirm-presence.page.scss'],
  standalone: true,
  imports: [
    CommonModule,
    LocalDatePipe,
    IonContent,
    IonCard,
    IonCardContent,
    IonIcon,
    IonText,
    IonButton,
    IonSpinner,
    TranslatePipe,
    AppHeaderComponent,
    AppFooterComponent
  ]
})
export class ConfirmPresencePage implements OnInit, OnDestroy {
  private destroy$ = new Subject<void>();
  private t = inject(TranslationService);

  isLoading = true;
  pendingAppointments: PendingAppointment[] = [];
  errorMessage: string | null = null;

  constructor(
    private route: ActivatedRoute,
    private consultationService: ConsultationService,
    private navCtrl: NavController,
    private toastCtrl: ToastController
  ) {}

  ngOnInit(): void {
    const idParam = this.route.snapshot.paramMap.get('id');
    const participantId = idParam ? parseInt(idParam, 10) : null;

    if (participantId) {
      this.loadParticipant(participantId);
    } else {
      this.isLoading = false;
      this.errorMessage = this.t.instant('confirmPresence.invalidLink');
    }
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  private loadParticipant(participantId: number): void {
    this.isLoading = true;
    this.errorMessage = null;

    this.consultationService.getParticipantById(participantId)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (participant) => {
          this.isLoading = false;
          const appointment = participant.appointment;
          if (appointment.status === 'scheduled') {
            this.pendingAppointments = [this.mapParticipant(participant, participantId)];
          } else {
            this.pendingAppointments = [];
            this.errorMessage = this.t.instant('confirmPresence.noLongerPending');
          }
        },
        error: () => {
          this.isLoading = false;
          this.errorMessage = this.t.instant('confirmPresence.failedLoad');
        }
      });
  }

  private mapParticipant(participant: IParticipantDetail, participantId: number): PendingAppointment {
    const apt = participant.appointment;
    const createdBy = apt.created_by;
    const doctorName = createdBy
      ? `${createdBy.first_name || ''} ${createdBy.last_name || ''}`.trim() || this.t.instant('confirmPresence.healthcareProvider')
      : this.t.instant('confirmPresence.healthcareProvider');

    return {
      id: apt.id,
      participantId: participant.id ?? participantId,
      scheduled_at: apt.scheduled_at,
      type: apt.type,
      doctorName,
      isConfirming: false,
      isDeclining: false
    };
  }

  confirmPresence(appointment: PendingAppointment): void {
    appointment.isConfirming = true;

    this.consultationService.confirmParticipantPresence(appointment.participantId, true)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: async () => {
          appointment.isConfirming = false;
          this.pendingAppointments = this.pendingAppointments.filter(a => a.id !== appointment.id);
          const toast = await this.toastCtrl.create({
            message: this.t.instant('confirmPresence.confirmSuccess'),
            duration: 2000,
            position: 'top',
            color: 'success'
          });
          await toast.present();
          this.checkAllConfirmed();
        },
        error: async () => {
          appointment.isConfirming = false;
          const toast = await this.toastCtrl.create({
            message: this.t.instant('confirmPresence.failedConfirm'),
            duration: 2000,
            position: 'top',
            color: 'danger'
          });
          await toast.present();
        }
      });
  }

  declinePresence(appointment: PendingAppointment): void {
    appointment.isDeclining = true;

    this.consultationService.confirmParticipantPresence(appointment.participantId, false)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: async () => {
          appointment.isDeclining = false;
          this.pendingAppointments = this.pendingAppointments.filter(a => a.id !== appointment.id);
          const toast = await this.toastCtrl.create({
            message: this.t.instant('confirmPresence.declined'),
            duration: 2000,
            position: 'top',
            color: 'warning'
          });
          await toast.present();
          this.checkAllConfirmed();
        },
        error: async () => {
          appointment.isDeclining = false;
          const toast = await this.toastCtrl.create({
            message: this.t.instant('confirmPresence.failedDecline'),
            duration: 2000,
            position: 'top',
            color: 'danger'
          });
          await toast.present();
        }
      });
  }

  private checkAllConfirmed(): void {
    if (this.pendingAppointments.length === 0) {
      setTimeout(() => {
        this.navCtrl.navigateRoot('/home');
      }, 1500);
    }
  }

  goToHome(): void {
    this.navCtrl.navigateRoot('/home');
  }

  formatDate(dateString: string): string {
    return formatDateFromISO(dateString);
  }

  formatTime(dateString: string): string {
    return formatTimeFromISO(dateString);
  }
}
