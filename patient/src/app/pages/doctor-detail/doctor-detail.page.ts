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
  IonSpinner,
  NavController,
  ToastController
} from '@ionic/angular/standalone';
import { DoctorService } from '../../core/services/doctor.service';
import { SpecialityService } from '../../core/services/speciality.service';
import { Doctor } from '../../core/models/doctor.model';
import { Slot } from '../../core/models/consultation.model';

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
  isLoadingSlots = false;
  availableSlots: { date: Date; day: string; dateStr: string; month: string; slots: string[]; isToday: boolean }[] = [];
  reviews: Review[] = [];

  weekDays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  constructor(
    private route: ActivatedRoute,
    private navCtrl: NavController,
    private doctorService: DoctorService,
    private specialityService: SpecialityService,
    private toastCtrl: ToastController
  ) {}

  ngOnInit() {
    const doctorId = this.route.snapshot.paramMap.get('id');
    if (doctorId) {
      this.loadDoctorDetails(parseInt(doctorId));
    }
  }

  loadDoctorDetails(doctorId: number): void {
    this.isLoading = true;
    this.doctorService.getDoctorById(doctorId).subscribe({
      next: (doctor) => {
        this.doctor = doctor;
        this.isLoading = false;
        this.loadAvailableSlots();
      },
      error: () => {
        this.isLoading = false;
        this.showToast('Failed to load doctor details');
      }
    });
  }

  loadAvailableSlots(): void {
    if (!this.doctor?.specialities?.length) {
      this.generateDefaultSlots();
      return;
    }

    const specialityId = this.doctor.specialities[0].id;
    this.isLoadingSlots = true;

    this.specialityService.getReasonsBySpeciality(specialityId).subscribe({
      next: (reasons) => {
        if (reasons.length > 0) {
          this.doctorService.getAvailableSlots(reasons[0].id).subscribe({
            next: (slots) => {
              this.processTimeSlots(slots);
              this.isLoadingSlots = false;
            },
            error: () => {
              this.generateDefaultSlots();
              this.isLoadingSlots = false;
            }
          });
        } else {
          this.generateDefaultSlots();
          this.isLoadingSlots = false;
        }
      },
      error: () => {
        this.generateDefaultSlots();
        this.isLoadingSlots = false;
      }
    });
  }

  private processTimeSlots(slots: Slot[]): void {
    const slotsByDate: Map<string, string[]> = new Map();

    slots.forEach(slot => {
      const dateKey = slot.date;
      if (!slotsByDate.has(dateKey)) {
        slotsByDate.set(dateKey, []);
      }
      slotsByDate.get(dateKey)?.push(slot.start_time);
    });

    this.availableSlots = [];
    const today = new Date();

    slotsByDate.forEach((times, dateStr) => {
      const date = new Date(dateStr);
      this.availableSlots.push({
        date,
        day: this.weekDays[date.getDay()],
        dateStr: date.getDate().toString(),
        month: date.toLocaleDateString('en', { month: 'short' }),
        slots: times,
        isToday: date.toDateString() === today.toDateString()
      });
    });

    this.availableSlots.sort((a, b) => a.date.getTime() - b.date.getTime());
  }

  private generateDefaultSlots(): void {
    const today = new Date();
    this.availableSlots = [];
    const defaultTimes = [
      '09:00', '09:30', '10:00', '10:30',
      '11:00', '11:30', '14:00', '14:30',
      '15:00', '15:30', '16:00', '16:30'
    ];

    for (let i = 0; i < 7; i++) {
      const date = new Date(today);
      date.setDate(today.getDate() + i);

      this.availableSlots.push({
        date,
        day: this.weekDays[date.getDay()],
        dateStr: date.getDate().toString(),
        month: date.toLocaleDateString('en', { month: 'short' }),
        slots: i === 0 ? defaultTimes.slice(4) : defaultTimes,
        isToday: i === 0
      });
    }
  }

  segmentChanged(event: CustomEvent): void {
    this.selectedSegment = event.detail.value;
  }

  bookAppointment(): void {
    if (this.doctor) {
      this.navCtrl.navigateForward(`/book-appointment?doctorId=${this.doctor.id}`);
    }
  }

  async messageDoctor(): Promise<void> {
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

  formatTime(time: string): string {
    const [hours, minutes] = time.split(':');
    const hour = parseInt(hours);
    const ampm = hour >= 12 ? 'PM' : 'AM';
    const displayHour = hour % 12 || 12;
    return `${displayHour}:${minutes} ${ampm}`;
  }

  async showToast(message: string): Promise<void> {
    const toast = await this.toastCtrl.create({
      message,
      duration: 2000,
      color: 'danger'
    });
    toast.present();
  }
}