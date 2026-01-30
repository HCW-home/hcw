import { Component, OnInit, OnDestroy } from '@angular/core';
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
import { Subject, takeUntil } from 'rxjs';
import { ConsultationService } from '../../core/services/consultation.service';
import { IParticipantDetail } from '../../core/models/consultation.model';
import { formatDateFromISO, formatTimeFromISO } from '../../core/utils/date-helper';

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
    IonContent,
    IonCard,
    IonCardContent,
    IonIcon,
    IonText,
    IonButton,
    IonSpinner
  ]
})
export class ConfirmPresencePage implements OnInit, OnDestroy {
  private destroy$ = new Subject<void>();

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
      this.errorMessage = 'Invalid confirmation link';
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
            this.pendingAppointments = [this.mapParticipant(participant)];
          } else {
            this.pendingAppointments = [];
            this.errorMessage = 'This appointment is no longer pending confirmation';
          }
        },
        error: () => {
          this.isLoading = false;
          this.errorMessage = 'Failed to load appointment';
        }
      });
  }

  private mapParticipant(participant: IParticipantDetail): PendingAppointment {
    const apt = participant.appointment;
    const createdBy = apt.created_by;
    const doctorName = createdBy
      ? `${createdBy.first_name || ''} ${createdBy.last_name || ''}`.trim() || 'Healthcare Provider'
      : 'Healthcare Provider';

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

  confirmPresence(appointment: PendingAppointment): void {
    appointment.isConfirming = true;

    this.consultationService.confirmParticipantPresence(appointment.participantId, true)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: async () => {
          appointment.isConfirming = false;
          this.pendingAppointments = this.pendingAppointments.filter(a => a.id !== appointment.id);
          const toast = await this.toastCtrl.create({
            message: 'Presence confirmed successfully',
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
            message: 'Failed to confirm presence',
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
            message: 'You have declined the appointment',
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
            message: 'Failed to decline',
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
