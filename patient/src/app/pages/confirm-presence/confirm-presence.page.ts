import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule, DatePipe } from '@angular/common';
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
import { Appointment, AppointmentStatus } from '../../core/models/consultation.model';

interface PendingAppointment {
  id: number;
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
  private datePipe = new DatePipe('en-US');

  isLoading = true;
  pendingAppointments: PendingAppointment[] = [];
  errorMessage: string | null = null;

  constructor(
    private consultationService: ConsultationService,
    private navCtrl: NavController,
    private toastCtrl: ToastController
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

    this.consultationService.getMyAppointments({ status: 'scheduled' })
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (response) => {
          this.isLoading = false;
          const now = new Date();
          const scheduledStatus: AppointmentStatus = 'scheduled';
          this.pendingAppointments = response.results
            .filter(apt => {
              const scheduledDate = new Date(apt.scheduled_at);
              return scheduledDate > now && apt.status === scheduledStatus;
            })
            .map(apt => this.mapAppointment(apt));
        },
        error: () => {
          this.isLoading = false;
          this.errorMessage = 'Failed to load appointments';
        }
      });
  }

  private mapAppointment(apt: Appointment): PendingAppointment {
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

  confirmPresence(appointment: PendingAppointment): void {
    appointment.isConfirming = true;

    this.consultationService.confirmAppointmentPresence(appointment.id, true)
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

    this.consultationService.confirmAppointmentPresence(appointment.id, false)
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
    return this.datePipe.transform(dateString, 'EEEE, MMMM d, y') || '';
  }

  formatTime(dateString: string): string {
    return this.datePipe.transform(dateString, 'h:mm a') || '';
  }
}
