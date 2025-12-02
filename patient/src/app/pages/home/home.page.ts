import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import {
  IonHeader,
  IonToolbar,
  IonTitle,
  IonButtons,
  IonButton,
  IonIcon,
  IonBadge,
  IonContent,
  IonRefresher,
  IonRefresherContent,
  IonSearchbar,
  IonGrid,
  IonRow,
  IonCol,
  IonCard,
  IonCardContent,
  IonText,
  IonSpinner,
  NavController
} from '@ionic/angular/standalone';
import { Subscription } from 'rxjs';
import { AuthService } from '../../core/services/auth.service';
import { DoctorService } from '../../core/services/doctor.service';
import { ConsultationService } from '../../core/services/consultation.service';
import { NotificationService } from '../../core/services/notification.service';
import { User } from '../../core/models/user.model';
import { Doctor } from '../../core/models/doctor.model';
import { Appointment } from '../../core/models/consultation.model';
import { DoctorCardComponent } from '../../shared/components/doctor-card/doctor-card.component';

@Component({
  selector: 'app-home',
  templateUrl: './home.page.html',
  styleUrls: ['./home.page.scss'],
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    IonHeader,
    IonToolbar,
    IonTitle,
    IonButtons,
    IonButton,
    IonIcon,
    IonBadge,
    IonContent,
    IonRefresher,
    IonRefresherContent,
    IonSearchbar,
    IonGrid,
    IonRow,
    IonCol,
    IonCard,
    IonCardContent,
    IonText,
    IonSpinner,
    DoctorCardComponent
  ]
})
export class HomePage implements OnInit, OnDestroy {
  currentUser: User | null = null;
  nearbyDoctors: Doctor[] = [];
  isLoadingDoctors = false;
  unreadNotifications = 0;

  quickActions = [
    {
      icon: 'medical-outline',
      title: 'Find Doctor',
      color: 'primary',
      route: '/doctors'
    },
    {
      icon: 'calendar-outline',
      title: 'Book Appointment',
      color: 'secondary',
      route: '/doctors'
    },
    {
      icon: 'document-text-outline',
      title: 'Health Records',
      color: 'tertiary',
      route: '/health-records'
    }
  ];

  upcomingAppointment: Appointment | null = null;

  private subscriptions: Subscription[] = [];

  constructor(
    private navCtrl: NavController,
    private authService: AuthService,
    private doctorService: DoctorService,
    private consultationService: ConsultationService,
    private notificationService: NotificationService,
  ) {}

  ngOnInit() {
    this.loadUserData();
    this.loadNearbyDoctors();
    this.loadUpcomingAppointment();
    this.loadUnreadCount();
  }

  ngOnDestroy() {
    this.subscriptions.forEach(sub => sub.unsubscribe());
  }

  ionViewWillEnter() {
    this.refreshData();
  }

  loadUserData(): void {
    const sub = this.authService.currentUser$.subscribe(user => {
      this.currentUser = user;
    });
    this.subscriptions.push(sub);
  }

  loadNearbyDoctors(): void {
    this.isLoadingDoctors = true;
    this.doctorService.getDoctors({ limit: 4, is_online: true }).subscribe({
      next: (response) => {
        this.nearbyDoctors = response.results.slice(0, 4);
        this.isLoadingDoctors = false;
      },
      error: () => {
        this.nearbyDoctors = [];
        this.isLoadingDoctors = false;
      }
    });
  }

  loadUpcomingAppointment(): void {
    this.consultationService.getMyAppointments({ status: 'SCHEDULED', limit: 1 }).subscribe({
      next: (response) => {
        if (response.results.length > 0) {
          const upcoming = response.results.find(apt => {
            const aptDate = new Date(apt.scheduled_at);
            return aptDate > new Date() && apt.status === 'SCHEDULED';
          });
          this.upcomingAppointment = upcoming || null;
        }
      },
      error: () => {
        this.upcomingAppointment = null;
      }
    });
  }

  loadUnreadCount(): void {
    const sub = this.notificationService.unreadCount$.subscribe(count => {
      this.unreadNotifications = count;
    });
    this.subscriptions.push(sub);

    this.notificationService.getNotifications({ limit: 10 }).subscribe();
  }

  refreshData(event?: { target: { complete: () => void } }): void {
    this.loadNearbyDoctors();
    this.loadUpcomingAppointment();
    this.notificationService.getNotifications({ limit: 10 }).subscribe({
      complete: () => {
        event?.target.complete();
      }
    });
  }

  navigateToAction(route: string): void {
    this.navCtrl.navigateForward(route);
  }

  viewAllDoctors(): void {
    this.navCtrl.navigateForward('/doctors');
  }

  viewDoctorDetails(doctor: Doctor): void {
    this.navCtrl.navigateForward(`/doctor/${doctor.id}`);
  }

  bookAppointment(doctor: Doctor): void {
    this.navCtrl.navigateForward(`/book-appointment?doctorId=${doctor.id}`);
  }

  searchDoctors(event: CustomEvent): void {
    const searchTerm = event.detail?.value;
    if (searchTerm && searchTerm.trim() !== '') {
      this.navCtrl.navigateForward(`/doctors?search=${encodeURIComponent(searchTerm)}`);
    }
  }

  goToNotifications(): void {
    this.navCtrl.navigateForward('/tabs/notifications');
  }

  viewAppointment(): void {
    this.navCtrl.navigateForward('/tabs/appointments');
  }

  formatAppointmentDate(dateString: string): string {
    const date = new Date(dateString);
    const today = new Date();
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    if (date.toDateString() === today.toDateString()) {
      return 'Today at ' + date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    } else if (date.toDateString() === tomorrow.toDateString()) {
      return 'Tomorrow at ' + date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    } else {
      return date.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' }) +
        ' at ' + date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }
  }

  getAppointmentDoctor(appointment: Appointment): string {
    const participant = appointment.participants?.find(p => p.user && p.user.id !== appointment.created_by.id);
    if (participant?.user) {
      return `Dr. ${participant.user.first_name} ${participant.user.last_name}`;
    }
    return `Dr. ${appointment.created_by.first_name} ${appointment.created_by.last_name}`;
  }
}
