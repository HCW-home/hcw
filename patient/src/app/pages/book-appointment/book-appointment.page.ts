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
  IonContent,
  IonCard,
  IonCardContent,
  IonText,
  IonLabel,
  IonIcon,
  IonButton,
  IonItem,
  IonDatetime,
  IonTextarea,
  IonChip,
  IonProgressBar,
  IonAvatar,
  NavController,
  LoadingController,
  ToastController,
  AlertController
} from '@ionic/angular/standalone';
import { DoctorService } from '../../core/services/doctor.service';
import { SpecialityService } from '../../core/services/speciality.service';
import { ConsultationService } from '../../core/services/consultation.service';
import { Doctor } from '../../core/models/doctor.model';
import { Reason } from '../../core/models/consultation.model';
import { TimeSlot } from '../../core/models/booking.model';

interface AppointmentSlot {
  time: string;
  available: boolean;
  selected?: boolean;
}

@Component({
  selector: 'app-book-appointment',
  templateUrl: './book-appointment.page.html',
  styleUrls: ['./book-appointment.page.scss'],
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    IonHeader,
    IonToolbar,
    IonTitle,
    IonButtons,
    IonBackButton,
    IonContent,
    IonCard,
    IonCardContent,
    IonText,
    IonLabel,
    IonIcon,
    IonButton,
    IonItem,
    IonDatetime,
    IonTextarea,
    IonChip,
    IonProgressBar,
    IonAvatar
  ]
})
export class BookAppointmentPage implements OnInit {
  currentStep = 1;
  totalSteps = 4;
  doctorId: string | null = null;
  selectedDoctor: Doctor | null = null;
  reasons: Reason[] = [];
  selectedReason: Reason | null = null;
  isLoadingDoctor = false;
  isLoadingSlots = false;

  appointmentData = {
    doctorId: null as number | null,
    appointmentType: 'video',
    date: '',
    time: '',
    reason: '',
    symptoms: '',
    notes: ''
  };

  selectedDate = '';
  availableSlots: AppointmentSlot[] = [];
  rawTimeSlots: TimeSlot[] = [];
  minDate: string;
  maxDate: string;

  appointmentTypes = [
    { value: 'video', label: 'Video Consultation', icon: 'videocam-outline', description: 'Online consultation via video call' },
    { value: 'in-person', label: 'In-Person Visit', icon: 'location-outline', description: 'Visit doctor at clinic' }
  ];

  commonSymptoms = ['Fever', 'Cough', 'Headache', 'Fatigue', 'Chest Pain', 'Other'];
  selectedSymptoms: string[] = [];

  constructor(
    private route: ActivatedRoute,
    private navCtrl: NavController,
    private doctorService: DoctorService,
    private specialityService: SpecialityService,
    private consultationService: ConsultationService,
    private loadingCtrl: LoadingController,
    private toastCtrl: ToastController,
    private alertCtrl: AlertController
  ) {
    const today = new Date();
    this.minDate = today.toISOString();

    const maxDate = new Date();
    maxDate.setMonth(maxDate.getMonth() + 3);
    this.maxDate = maxDate.toISOString();
  }

  ngOnInit() {
    this.doctorId = this.route.snapshot.queryParamMap.get('doctorId');
    if (this.doctorId) {
      this.appointmentData.doctorId = parseInt(this.doctorId);
      this.loadDoctorInfo();
    }
  }

  loadDoctorInfo(): void {
    if (!this.doctorId) return;

    this.isLoadingDoctor = true;
    this.doctorService.getDoctorById(parseInt(this.doctorId)).subscribe({
      next: (doctor) => {
        this.selectedDoctor = doctor;
        this.isLoadingDoctor = false;
        this.loadReasons();
      },
      error: () => {
        this.isLoadingDoctor = false;
        this.showToast('Failed to load doctor information');
      }
    });
  }

  loadReasons(): void {
    if (!this.selectedDoctor?.specialities?.length) return;

    const specialityId = this.selectedDoctor.specialities[0].id;
    this.specialityService.getReasonsBySpeciality(specialityId).subscribe({
      next: (reasons) => {
        this.reasons = reasons;
        if (reasons.length > 0) {
          this.selectedReason = reasons[0];
          this.loadAvailableSlots();
        }
      },
      error: () => {
        this.reasons = [];
      }
    });
  }

  loadAvailableSlots(): void {
    if (!this.selectedReason) {
      this.generateDefaultSlots();
      return;
    }

    this.isLoadingSlots = true;
    this.doctorService.getAvailableSlots(this.selectedReason.id).subscribe({
      next: (slots) => {
        this.rawTimeSlots = slots;
        this.updateSlotsForDate();
        this.isLoadingSlots = false;
      },
      error: () => {
        this.generateDefaultSlots();
        this.isLoadingSlots = false;
      }
    });
  }

  private updateSlotsForDate(): void {
    if (!this.selectedDate) {
      this.availableSlots = [];
      return;
    }

    const dateStr = new Date(this.selectedDate).toISOString().split('T')[0];
    const slotsForDate = this.rawTimeSlots.filter(slot => slot.date === dateStr);

    if (slotsForDate.length > 0) {
      this.availableSlots = slotsForDate.map(slot => ({
        time: this.formatTime(slot.start_time),
        available: slot.is_available,
        selected: false
      }));
    } else {
      this.generateDefaultSlots();
    }
  }

  private generateDefaultSlots(): void {
    const defaultSlots = [
      '09:00', '09:30', '10:00', '10:30',
      '11:00', '11:30', '14:00', '14:30',
      '15:00', '15:30', '16:00', '16:30'
    ];

    this.availableSlots = defaultSlots.map((time, index) => ({
      time: this.formatTime(time),
      available: index % 3 !== 0,
      selected: false
    }));
  }

  private formatTime(time: string): string {
    const [hours, minutes] = time.split(':');
    const hour = parseInt(hours);
    const ampm = hour >= 12 ? 'PM' : 'AM';
    const displayHour = hour % 12 || 12;
    return `${displayHour}:${minutes || '00'} ${ampm}`;
  }

  nextStep(): void {
    if (this.validateCurrentStep()) {
      if (this.currentStep < this.totalSteps) {
        this.currentStep++;
        if (this.currentStep === 2 && this.availableSlots.length === 0) {
          this.loadAvailableSlots();
        }
      } else {
        this.submitAppointment();
      }
    }
  }

  previousStep(): void {
    if (this.currentStep > 1) {
      this.currentStep--;
    }
  }

  validateCurrentStep(): boolean {
    switch (this.currentStep) {
      case 1:
        if (!this.appointmentData.appointmentType) {
          this.showToast('Please select appointment type');
          return false;
        }
        return true;
      case 2:
        if (!this.appointmentData.date || !this.appointmentData.time) {
          this.showToast('Please select date and time');
          return false;
        }
        return true;
      case 3:
        if (this.selectedSymptoms.length === 0 || !this.appointmentData.reason) {
          this.showToast('Please provide reason for visit');
          return false;
        }
        return true;
      case 4:
        return true;
      default:
        return false;
    }
  }

  onDateChange(event: CustomEvent): void {
    this.selectedDate = event.detail.value;
    this.appointmentData.date = this.selectedDate;
    this.appointmentData.time = '';
    this.availableSlots.forEach(s => s.selected = false);
    this.updateSlotsForDate();
  }

  selectTimeSlot(slot: AppointmentSlot): void {
    if (!slot.available) return;

    this.availableSlots.forEach(s => s.selected = false);
    slot.selected = true;
    this.appointmentData.time = slot.time;
  }

  toggleSymptom(symptom: string): void {
    const index = this.selectedSymptoms.indexOf(symptom);
    if (index > -1) {
      this.selectedSymptoms.splice(index, 1);
    } else {
      this.selectedSymptoms.push(symptom);
    }
  }

  selectReason(reason: Reason): void {
    this.selectedReason = reason;
    this.appointmentData.reason = reason.name;
    this.loadAvailableSlots();
  }

  async submitAppointment(): Promise<void> {
    const loading = await this.loadingCtrl.create({
      message: 'Booking appointment...'
    });
    await loading.present();

    const scheduledDate = new Date(this.appointmentData.date);
    const timeParts = this.appointmentData.time.match(/(\d+):(\d+)\s*(AM|PM)/i);
    if (timeParts) {
      let hours = parseInt(timeParts[1]);
      const minutes = parseInt(timeParts[2]);
      const ampm = timeParts[3].toUpperCase();
      if (ampm === 'PM' && hours !== 12) hours += 12;
      if (ampm === 'AM' && hours === 12) hours = 0;
      scheduledDate.setHours(hours, minutes, 0, 0);
    }

    const appointmentRequest = {
      type: this.appointmentData.appointmentType === 'video' ? 'ONLINE' as const : 'IN_PERSON' as const,
      scheduled_at: scheduledDate.toISOString()
    };

    this.consultationService.createAppointment(appointmentRequest).subscribe({
      next: () => {
        loading.dismiss();
        this.showSuccessAlert();
      },
      error: () => {
        loading.dismiss();
        this.showToast('Failed to book appointment. Please try again.');
      }
    });
  }

  async showSuccessAlert(): Promise<void> {
    const alert = await this.alertCtrl.create({
      header: 'Appointment Booked!',
      message: 'Your appointment has been successfully booked. You will receive a confirmation shortly.',
      buttons: [
        {
          text: 'View Appointments',
          handler: () => {
            this.navCtrl.navigateRoot('/tabs/appointments');
          }
        }
      ]
    });

    await alert.present();
  }

  async showToast(message: string): Promise<void> {
    const toast = await this.toastCtrl.create({
      message,
      duration: 2000,
      color: 'warning'
    });
    toast.present();
  }

  getProgressPercentage(): number {
    return (this.currentStep / this.totalSteps) * 100;
  }

  getStepTitle(): string {
    switch (this.currentStep) {
      case 1: return 'Select Appointment Type';
      case 2: return 'Choose Date & Time';
      case 3: return 'Describe Your Symptoms';
      case 4: return 'Review & Confirm';
      default: return '';
    }
  }

  formatDate(dateString: string): string {
    if (!dateString) return '';
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
  }
}
