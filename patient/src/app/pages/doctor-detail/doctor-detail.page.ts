import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';
import {
  IonHeader,
  IonToolbar,
  IonTitle,
  IonButtons,
  IonBackButton,
  IonButton,
  IonContent,
  IonCard,
  IonCardContent,
  IonAvatar,
  IonText,
  IonLabel,
  IonIcon,
  IonBadge,
  IonSegment,
  IonSegmentButton,
  IonList,
  IonItem,
  IonChip,
  IonGrid,
  IonRow,
  IonCol,
  IonSpinner,
  NavController,
  ToastController
} from '@ionic/angular/standalone';
import { ApiService } from '../../core/services/api.service';
import { Doctor } from '../../core/models/doctor.model';

interface Review {
  id: number;
  patient_name: string;
  rating: number;
  comment: string;
  date: string;
}

@Component({
  selector: 'app-doctor-detail',
  templateUrl: './doctor-detail.page.html',
  styleUrls: ['./doctor-detail.page.scss'],
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    IonHeader,
    IonToolbar,
    IonTitle,
    IonButtons,
    IonBackButton,
    IonButton,
    IonContent,
    IonCard,
    IonCardContent,
    IonAvatar,
    IonText,
    IonLabel,
    IonIcon,
    IonBadge,
    IonSegment,
    IonSegmentButton,
    IonList,
    IonItem,
    IonChip,
    IonSpinner
  ]
})
export class DoctorDetailPage implements OnInit {
  doctor: Doctor | null = null;
  selectedSegment = 'about';
  isLoading = true;
  reviews: Review[] = [];
  availableSlots: any[] = [];

  weekDays = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  timeSlots = [
    '09:00 AM', '09:30 AM', '10:00 AM', '10:30 AM',
    '11:00 AM', '11:30 AM', '02:00 PM', '02:30 PM',
    '03:00 PM', '03:30 PM', '04:00 PM', '04:30 PM'
  ];

  constructor(
    private route: ActivatedRoute,
    private navCtrl: NavController,
    private apiService: ApiService,
    private toastCtrl: ToastController
  ) {}

  ngOnInit() {
    const doctorId = this.route.snapshot.paramMap.get('id');
    if (doctorId) {
      this.loadDoctorDetails(doctorId);
    }
  }

  async loadDoctorDetails(doctorId: string) {
    try {
      this.isLoading = true;
      const doctor = await this.apiService.get<Doctor>(`/practitioners/${doctorId}/`).toPromise();
      if (doctor) {
        this.doctor = doctor;
      }
    } catch (error) {
      console.error('Error loading doctor details:', error);
      this.loadMockData(doctorId);
    } finally {
      this.isLoading = false;
    }
  }

  loadMockData(doctorId: string) {
    this.doctor = {
      id: parseInt(doctorId),
      first_name: 'John',
      last_name: 'Smith',
      email: 'john.smith@clinic.com',
      specialities: [{ id: 2, name: 'Cardiology', description: 'Heart Specialist' }],
      languages: [
        { id: 1, name: 'English', code: 'en' },
        { id: 2, name: 'Spanish', code: 'es' }
      ],
      is_online: true,
      rating: 4.8,
      reviews_count: 127,
      experience_years: 15,
      consultation_fee: 150,
      about: 'Dr. John Smith is a board-certified cardiologist with over 15 years of experience in treating cardiovascular diseases. He specializes in preventive cardiology, heart failure management, and interventional procedures.',
      education: [
        'MD - Harvard Medical School (2005)',
        'Residency - Johns Hopkins Hospital (2008)',
        'Fellowship - Mayo Clinic (2010)'
      ]
    };

    this.reviews = [
      {
        id: 1,
        patient_name: 'Sarah M.',
        rating: 5,
        comment: 'Excellent doctor! Very thorough and caring. Took time to explain everything.',
        date: '2 days ago'
      },
      {
        id: 2,
        patient_name: 'Robert L.',
        rating: 4,
        comment: 'Professional and knowledgeable. The wait time was a bit long though.',
        date: '1 week ago'
      },
      {
        id: 3,
        patient_name: 'Emily K.',
        rating: 5,
        comment: 'Best cardiologist I have ever visited. Highly recommend!',
        date: '2 weeks ago'
      }
    ];

    this.generateAvailableSlots();
  }

  generateAvailableSlots() {
    const today = new Date();
    this.availableSlots = [];

    for (let i = 0; i < 7; i++) {
      const date = new Date(today);
      date.setDate(today.getDate() + i);

      const daySlots = {
        date: date,
        day: this.weekDays[date.getDay()],
        dateStr: date.getDate().toString(),
        month: date.toLocaleDateString('en', { month: 'short' }),
        slots: i === 0 ? this.timeSlots.slice(4) : this.timeSlots,
        isToday: i === 0
      };

      this.availableSlots.push(daySlots);
    }
  }

  segmentChanged(event: any) {
    this.selectedSegment = event.detail.value;
  }

  bookAppointment() {
    if (this.doctor) {
      this.navCtrl.navigateForward(`/book-appointment?doctorId=${this.doctor.id}`);
    }
  }

  async messageDoctor() {
    const toast = await this.toastCtrl.create({
      message: 'Messaging feature coming soon',
      duration: 2000,
      color: 'primary'
    });
    toast.present();
  }

  getRatingStars(rating: number): number[] {
    return Array(5).fill(0).map((_, i) => i < Math.floor(rating) ? 1 : 0);
  }
}
