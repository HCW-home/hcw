import { Component, OnInit } from '@angular/core';
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
  IonList,
  IonItem,
  IonLabel,
  NavController
} from '@ionic/angular/standalone';
import { AuthService } from '../../core/services/auth.service';
import { User } from '../../core/models/user.model';
import { Doctor } from '../../core/models/doctor.model';
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
    IonList,
    IonItem,
    IonLabel,
    DoctorCardComponent
  ]
})
export class HomePage implements OnInit {
  currentUser: User | null = null;
  nearbyDoctors: Doctor[] = [];
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
      route: '/book-appointment'
    },
    {
      icon: 'document-text-outline',
      title: 'Health Records',
      color: 'tertiary',
      route: '/health-records'
    }
  ];

  upcomingAppointment: any = null;
  recentNotifications = [
    {
      icon: 'checkmark-circle',
      title: 'Appointment Confirmed',
      message: 'Your appointment with Dr. Smith is confirmed for tomorrow',
      time: '2 hours ago',
      color: 'success'
    },
    {
      icon: 'document-text',
      title: 'New Test Results',
      message: 'Your blood test results are now available',
      time: '1 day ago',
      color: 'primary'
    }
  ];

  constructor(
    private navCtrl: NavController,
    private authService: AuthService,
  ) {}

  ngOnInit() {
    this.loadUserData();
    this.loadNearbyDoctors();
  }

  ionViewWillEnter() {
    this.refreshData();
  }

  loadUserData() {
    this.authService.currentUser$.subscribe(user => {
      this.currentUser = user;
    });
  }

  loadNearbyDoctors() {
    // Mock data for now - will connect to actual API
    this.nearbyDoctors = [
      {
        id: 1,
        first_name: 'John',
        last_name: 'Smith',
        email: 'john.smith@example.com',
        specialities: [{ id: 1, name: 'Cardiologist' }],
        is_online: true,
        rating: 4.8,
        reviews_count: 127,
        experience_years: 15
      } as Doctor,
      {
        id: 2,
        first_name: 'Sarah',
        last_name: 'Johnson',
        email: 'sarah.johnson@example.com',
        specialities: [{ id: 2, name: 'Dermatologist' }],
        is_online: false,
        rating: 4.9,
        reviews_count: 89,
        experience_years: 12
      } as Doctor
    ];
  }

  refreshData(event?: any) {
    this.loadNearbyDoctors();
    setTimeout(() => {
      if (event) {
        event.target.complete();
      }
    }, 1000);
  }

  navigateToAction(route: string) {
    this.navCtrl.navigateForward(route);
  }

  viewAllDoctors() {
    this.navCtrl.navigateForward('/doctors');
  }

  viewDoctorDetails(doctor: Doctor) {
    this.navCtrl.navigateForward(`/doctor/${doctor.id}`);
  }

  bookAppointment(doctor: Doctor) {
    this.navCtrl.navigateForward(`/book-appointment?doctorId=${doctor.id}`);
  }

  searchDoctors(event: any) {
    const searchTerm = event.target.value;
    if (searchTerm && searchTerm.trim() !== '') {
      console.log('Searching for:', searchTerm);
    }
  }

  goToNotifications() {
    this.navCtrl.navigateForward('/tabs/notifications');
  }
}
