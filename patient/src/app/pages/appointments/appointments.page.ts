import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import {
  IonHeader,
  IonToolbar,
  IonTitle,
  IonContent,
  IonSegment,
  IonSegmentButton,
  IonLabel,
  IonCard,
  IonCardContent,
  IonList,
  IonIcon,
  IonText,
  IonButton,
  IonBadge,
  IonAvatar,
  IonChip,
  IonRefresher,
  IonRefresherContent,
  IonSpinner,
  NavController,
  AlertController,
  ToastController
} from '@ionic/angular/standalone';
import { ConsultationService } from '../../core/services/consultation.service';
import { Appointment } from '../../core/models/consultation.model';

interface DisplayAppointment {
  id: number;
  doctor_name: string;
  doctor_photo?: string;
  specialty: string;
  date: string;
  time: string;
  type: 'video' | 'in-person';
  status: 'upcoming' | 'completed' | 'cancelled';
  location?: string;
  notes?: string;
  consultation_fee?: number;
  originalAppointment: Appointment;
}

@Component({
  selector: 'app-appointments',
  templateUrl: './appointments.page.html',
  styleUrls: ['./appointments.page.scss'],
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    IonHeader,
    IonToolbar,
    IonTitle,
    IonContent,
    IonSegment,
    IonSegmentButton,
    IonLabel,
    IonCard,
    IonCardContent,
    IonList,
    IonIcon,
    IonText,
    IonButton,
    IonBadge,
    IonAvatar,
    IonChip,
    IonRefresher,
    IonRefresherContent,
    IonSpinner
  ]
})
export class AppointmentsPage implements OnInit {
  selectedSegment = 'upcoming';
  appointments: DisplayAppointment[] = [];
  filteredAppointments: DisplayAppointment[] = [];
  isLoading = false;

  constructor(
    private navCtrl: NavController,
    private consultationService: ConsultationService,
    private alertCtrl: AlertController,
    private toastCtrl: ToastController
  ) {}

  ngOnInit() {
    this.loadAppointments();
  }

  ionViewWillEnter() {
    this.loadAppointments();
  }

  segmentChanged(event: CustomEvent): void {
    this.selectedSegment = event.detail.value;
    this.filterAppointments();
  }

  async loadAppointments(): Promise<void> {
    this.isLoading = true;
    this.consultationService.getMyAppointments().subscribe({
      next: (response) => {
        this.appointments = response.results.map(apt => this.mapAppointment(apt));
        this.filterAppointments();
        this.isLoading = false;
      },
      error: () => {
        this.appointments = [];
        this.filterAppointments();
        this.isLoading = false;
      }
    });
  }

  private mapAppointment(apt: Appointment): DisplayAppointment {
    const scheduledDate = new Date(apt.scheduled_at);
    const now = new Date();
    const isPast = scheduledDate < now;

    let displayStatus: 'upcoming' | 'completed' | 'cancelled';
    if (apt.status === 'CANCELLED') {
      displayStatus = 'cancelled';
    } else if (isPast) {
      displayStatus = 'completed';
    } else {
      displayStatus = 'upcoming';
    }

    const doctorParticipant = apt.participants?.find(p => p.user && p.user.id !== apt.created_by.id);
    const doctorName = doctorParticipant?.user
      ? `Dr. ${doctorParticipant.user.first_name} ${doctorParticipant.user.last_name}`
      : `Dr. ${apt.created_by.first_name} ${apt.created_by.last_name}`;

    return {
      id: apt.id,
      doctor_name: doctorName,
      doctor_photo: doctorParticipant?.user?.picture,
      specialty: 'Specialist',
      date: apt.scheduled_at,
      time: scheduledDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      type: apt.type === 'ONLINE' ? 'video' : 'in-person',
      status: displayStatus,
      originalAppointment: apt
    };
  }

  filterAppointments(): void {
    this.filteredAppointments = this.appointments.filter(apt => apt.status === this.selectedSegment);
  }

  handleRefresh(event: { target: { complete: () => void } }): void {
    this.consultationService.getMyAppointments().subscribe({
      next: (response) => {
        this.appointments = response.results.map(apt => this.mapAppointment(apt));
        this.filterAppointments();
        event.target.complete();
      },
      error: () => {
        event.target.complete();
      }
    });
  }

  getStatusColor(status: string): string {
    switch (status) {
      case 'upcoming': return 'primary';
      case 'completed': return 'success';
      case 'cancelled': return 'danger';
      default: return 'medium';
    }
  }

  getTypeIcon(type: string): string {
    return type === 'video' ? 'videocam-outline' : 'location-outline';
  }

  async rescheduleAppointment(appointment: DisplayAppointment): Promise<void> {
    const alert = await this.alertCtrl.create({
      header: 'Reschedule Appointment',
      message: 'Are you sure you want to reschedule this appointment?',
      buttons: [
        {
          text: 'Cancel',
          role: 'cancel'
        },
        {
          text: 'Reschedule',
          handler: () => {
            this.navCtrl.navigateForward(`/book-appointment?appointmentId=${appointment.id}&reschedule=true`);
          }
        }
      ]
    });
    await alert.present();
  }

  async cancelAppointment(appointment: DisplayAppointment): Promise<void> {
    const alert = await this.alertCtrl.create({
      header: 'Cancel Appointment',
      message: 'Are you sure you want to cancel this appointment?',
      buttons: [
        {
          text: 'No',
          role: 'cancel'
        },
        {
          text: 'Yes, Cancel',
          handler: () => {
            this.consultationService.cancelAppointment(appointment.id).subscribe({
              next: () => {
                appointment.status = 'cancelled';
                this.filterAppointments();
                this.showToast('Appointment cancelled successfully');
              },
              error: () => {
                this.showToast('Failed to cancel appointment', 'danger');
              }
            });
          }
        }
      ]
    });
    await alert.present();
  }

  joinVideoCall(appointment: DisplayAppointment): void {
    const consultationId = appointment.originalAppointment.consultation || appointment.id;
    this.navCtrl.navigateForward(`/consultation/${consultationId}/video`);
  }

  viewDetails(appointment: DisplayAppointment): void {
    if (appointment.originalAppointment.consultation) {
      this.navCtrl.navigateForward(`/consultation/${appointment.originalAppointment.consultation}`);
    } else {
      this.showToast('Appointment details coming soon');
    }
  }

  rateAppointment(appointment: DisplayAppointment): void {
    this.showToast('Rate & review coming soon');
  }

  bookNewAppointment(): void {
    this.navCtrl.navigateForward('/doctors');
  }

  formatDate(dateString: string): string {
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      year: 'numeric'
    });
  }

  isUpcomingToday(dateString: string): boolean {
    const today = new Date();
    const aptDate = new Date(dateString);
    return today.toDateString() === aptDate.toDateString();
  }

  async showToast(message: string, color: string = 'primary'): Promise<void> {
    const toast = await this.toastCtrl.create({
      message,
      duration: 2000,
      color
    });
    toast.present();
  }
}
