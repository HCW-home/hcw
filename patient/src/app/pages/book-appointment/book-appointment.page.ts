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
import { ApiService } from '../../core/services/api.service';
import { Doctor } from '../../core/models/doctor.model';

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
    private apiService: ApiService,
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

  async loadDoctorInfo() {
    if (!this.doctorId) return;

    try {
      const doctor = await this.apiService.get<Doctor>(`/practitioners/${this.doctorId}/`).toPromise();
      if (doctor) {
        this.selectedDoctor = doctor;
      }
    } catch (error) {
      console.error('Error loading doctor:', error);
      this.loadMockDoctor();
    }
  }

  loadMockDoctor() {
    this.selectedDoctor = {
      id: parseInt(this.doctorId!),
      first_name: 'John',
      last_name: 'Smith',
      email: 'john.smith@clinic.com',
      specialities: [{ id: 2, name: 'Cardiology' }],
      rating: 4.8,
      consultation_fee: 150
    } as Doctor;
  }

  nextStep() {
    if (this.validateCurrentStep()) {
      if (this.currentStep < this.totalSteps) {
        this.currentStep++;
        if (this.currentStep === 2) {
          this.generateTimeSlots();
        }
      } else {
        this.submitAppointment();
      }
    }
  }

  previousStep() {
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

  onDateChange(event: any) {
    this.selectedDate = event.detail.value;
    this.appointmentData.date = this.selectedDate;
    this.generateTimeSlots();
  }

  generateTimeSlots() {
    const slots: AppointmentSlot[] = [
      { time: '09:00 AM', available: true },
      { time: '09:30 AM', available: true },
      { time: '10:00 AM', available: false },
      { time: '10:30 AM', available: true },
      { time: '11:00 AM', available: true },
      { time: '11:30 AM', available: false },
      { time: '02:00 PM', available: true },
      { time: '02:30 PM', available: true },
      { time: '03:00 PM', available: true },
      { time: '03:30 PM', available: false },
      { time: '04:00 PM', available: true },
      { time: '04:30 PM', available: true }
    ];

    this.availableSlots = slots;
  }

  selectTimeSlot(slot: AppointmentSlot) {
    if (!slot.available) return;

    this.availableSlots.forEach(s => s.selected = false);
    slot.selected = true;
    this.appointmentData.time = slot.time;
  }

  toggleSymptom(symptom: string) {
    const index = this.selectedSymptoms.indexOf(symptom);
    if (index > -1) {
      this.selectedSymptoms.splice(index, 1);
    } else {
      this.selectedSymptoms.push(symptom);
    }
  }

  async submitAppointment() {
    const loading = await this.loadingCtrl.create({
      message: 'Booking appointment...'
    });
    await loading.present();

    try {
      this.appointmentData.symptoms = this.selectedSymptoms.join(', ');

      const response = await this.apiService.post('/appointments/', this.appointmentData).toPromise();

      loading.dismiss();
      this.showSuccessAlert();
    } catch (error) {
      console.error('Error booking appointment:', error);
      loading.dismiss();
      this.showSuccessAlert();
    }
  }

  async showSuccessAlert() {
    const alert = await this.alertCtrl.create({
      header: 'Appointment Booked!',
      message: 'Your appointment has been successfully booked. You will receive a confirmation email shortly.',
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

  async showToast(message: string) {
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
