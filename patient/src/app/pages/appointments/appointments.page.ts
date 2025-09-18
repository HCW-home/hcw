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
import { ApiService } from '../../core/services/api.service';

interface Appointment {
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
  consultation_fee: number;
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
  appointments: Appointment[] = [];
  filteredAppointments: Appointment[] = [];
  isLoading = false;

  mockAppointments: Appointment[] = [
    {
      id: 1,
      doctor_name: 'Dr. John Smith',
      specialty: 'Cardiologist',
      date: '2024-02-15',
      time: '10:00 AM',
      type: 'in-person',
      status: 'upcoming',
      location: 'Heart Care Center, Room 302',
      consultation_fee: 150
    },
    {
      id: 2,
      doctor_name: 'Dr. Sarah Johnson',
      specialty: 'Dermatologist',
      date: '2024-02-20',
      time: '2:30 PM',
      type: 'video',
      status: 'upcoming',
      consultation_fee: 120
    },
    {
      id: 3,
      doctor_name: 'Dr. Michael Chen',
      specialty: 'General Physician',
      date: '2024-01-10',
      time: '11:00 AM',
      type: 'in-person',
      status: 'completed',
      location: 'City Medical Center',
      notes: 'Regular checkup completed',
      consultation_fee: 100
    },
    {
      id: 4,
      doctor_name: 'Dr. Emily Davis',
      specialty: 'Neurologist',
      date: '2024-01-05',
      time: '3:00 PM',
      type: 'video',
      status: 'completed',
      notes: 'Follow-up consultation',
      consultation_fee: 200
    },
    {
      id: 5,
      doctor_name: 'Dr. Robert Wilson',
      specialty: 'Orthopedist',
      date: '2024-01-25',
      time: '9:00 AM',
      type: 'in-person',
      status: 'cancelled',
      location: 'Bone & Joint Clinic',
      consultation_fee: 180
    }
  ];

  constructor(
    private navCtrl: NavController,
    private apiService: ApiService,
    private alertCtrl: AlertController,
    private toastCtrl: ToastController
  ) {}

  ngOnInit() {
    this.loadAppointments();
  }

  ionViewWillEnter() {
    this.loadAppointments();
  }

  segmentChanged(event: any) {
    this.selectedSegment = event.detail.value;
    this.filterAppointments();
  }

  async loadAppointments() {
    this.isLoading = true;
    try {
      const response = await this.apiService.get<any>('/appointments/').toPromise();
      if (response) {
        this.appointments = response.results || [];
        this.filterAppointments();
      }
    } catch (error) {
      // Use mock data for now
      this.appointments = this.mockAppointments;
      this.filterAppointments();
    } finally {
      this.isLoading = false;
    }
  }

  filterAppointments() {
    this.filteredAppointments = this.appointments.filter(apt => apt.status === this.selectedSegment);
  }

  handleRefresh(event: any) {
    this.loadAppointments().then(() => {
      event.target.complete();
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

  async rescheduleAppointment(appointment: Appointment) {
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
            this.navCtrl.navigateForward(`/book-appointment?doctorId=${appointment.id}&reschedule=true`);
          }
        }
      ]
    });
    await alert.present();
  }

  async cancelAppointment(appointment: Appointment) {
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
          handler: async () => {
            try {
              await this.apiService.patch(`/appointments/${appointment.id}/`, { status: 'cancelled' }).toPromise();
              appointment.status = 'cancelled';
              this.filterAppointments();
              this.showToast('Appointment cancelled successfully');
            } catch (error) {
              // Mock success for now
              appointment.status = 'cancelled';
              this.filterAppointments();
              this.showToast('Appointment cancelled successfully');
            }
          }
        }
      ]
    });
    await alert.present();
  }

  joinVideoCall(appointment: Appointment) {
    this.showToast('Joining video call...');
  }

  viewDetails(appointment: Appointment) {
    // Navigate to appointment details
    this.showToast('Appointment details coming soon');
  }

  rateAppointment(appointment: Appointment) {
    this.showToast('Rate & review coming soon');
  }

  bookNewAppointment() {
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

  async showToast(message: string) {
    const toast = await this.toastCtrl.create({
      message,
      duration: 2000,
      color: 'primary'
    });
    toast.present();
  }
}
