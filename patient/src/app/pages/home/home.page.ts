import { Component, OnInit, OnDestroy, signal, computed } from '@angular/core';
import { CommonModule, DatePipe } from '@angular/common';
import {
  IonHeader,
  IonToolbar,
  IonButtons,
  IonButton,
  IonIcon,
  IonContent,
  IonRefresher,
  IonRefresherContent,
  IonSpinner,
  NavController,
  ToastController
} from '@ionic/angular/standalone';
import { Subject, takeUntil } from 'rxjs';
import { AuthService } from '../../core/services/auth.service';
import { ConsultationService } from '../../core/services/consultation.service';
import { User } from '../../core/models/user.model';
import { ConsultationRequest, Consultation, Speciality, Appointment } from '../../core/models/consultation.model';

interface RequestStatus {
  label: string;
  color: 'warning' | 'info' | 'primary' | 'success' | 'muted';
}

@Component({
  selector: 'app-home',
  templateUrl: './home.page.html',
  styleUrls: ['./home.page.scss'],
  standalone: true,
  imports: [
    CommonModule,
    DatePipe,
    IonHeader,
    IonToolbar,
    IonButtons,
    IonButton,
    IonIcon,
    IonContent,
    IonRefresher,
    IonRefresherContent,
    IonSpinner
  ]
})
export class HomePage implements OnInit, OnDestroy {
  private destroy$ = new Subject<void>();

  currentUser = signal<User | null>(null);
  requests = signal<ConsultationRequest[]>([]);
  consultations = signal<Consultation[]>([]);
  appointments = signal<Appointment[]>([]);
  isLoading = signal(false);

  totalRequests = computed(() => this.requests().length);
  totalConsultations = computed(() => this.consultations().length);
  totalAppointments = computed(() => this.appointments().length);

  constructor(
    private navCtrl: NavController,
    private authService: AuthService,
    private consultationService: ConsultationService,
    private toastController: ToastController
  ) {}

  private async showError(message: string): Promise<void> {
    const toast = await this.toastController.create({
      message,
      duration: 3000,
      position: 'bottom',
      color: 'danger'
    });
    await toast.present();
  }

  ngOnInit(): void {
    this.loadUserData();
    this.loadDashboard();
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  ionViewWillEnter(): void {
    this.loadDashboard();
  }

  loadUserData(): void {
    this.authService.currentUser$
      .pipe(takeUntil(this.destroy$))
      .subscribe(user => {
        this.currentUser.set(user);
      });
  }

  loadDashboard(): void {
    this.isLoading.set(true);
    this.consultationService.getDashboard()
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (response) => {
          this.requests.set(response.requests);
          this.consultations.set(response.consultations);
          this.appointments.set(response.appointments);
          this.isLoading.set(false);
        },
        error: (error) => {
          this.showError(error?.error?.detail || 'Failed to load dashboard');
          this.isLoading.set(false);
        }
      });
  }

  refreshData(event: { target: { complete: () => void } }): void {
    this.consultationService.getDashboard()
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (response) => {
          this.requests.set(response.requests);
          this.consultations.set(response.consultations);
          this.appointments.set(response.appointments);
          event.target.complete();
        },
        error: (error) => {
          this.showError(error?.error?.detail || 'Failed to load dashboard');
          event.target.complete();
        }
      });
  }

  goToNewRequest(): void {
    this.navCtrl.navigateForward('/new-request');
  }

  viewRequestDetails(request: ConsultationRequest): void {
    this.navCtrl.navigateForward(`/request-detail/${request.id}`);
  }

  goToProfile(): void {
    this.navCtrl.navigateForward('/profile');
  }

  getStatusConfig(status: string | undefined): RequestStatus {
    const normalizedStatus = (status || 'Requested').toLowerCase();
    const statusMap: Record<string, RequestStatus> = {
      'requested': { label: 'Pending', color: 'warning' },
      'accepted': { label: 'Accepted', color: 'info' },
      'scheduled': { label: 'Scheduled', color: 'primary' },
      'cancelled': { label: 'Cancelled', color: 'muted' },
      'refused': { label: 'Refused', color: 'muted' }
    };
    return statusMap[normalizedStatus] || statusMap['requested'];
  }

  hasAppointment(request: ConsultationRequest): boolean {
    return !!request.appointment;
  }

  hasConsultation(request: ConsultationRequest): boolean {
    return !!request.consultation;
  }

  getReasonName(request: ConsultationRequest): string {
    if (typeof request.reason === 'object' && request.reason) {
      return request.reason.name;
    }
    return 'Consultation';
  }

  getSpecialityName(request: ConsultationRequest): string {
    if (typeof request.reason === 'object' && request.reason) {
      const speciality = request.reason.speciality;
      if (typeof speciality === 'object' && speciality) {
        return (speciality as Speciality).name;
      }
    }
    return '';
  }

  getDoctorName(request: ConsultationRequest): string {
    if (request.appointment?.participants) {
      const doctor = request.appointment.participants.find(p => p.user && p.user.id !== request.created_by?.id);
      if (doctor?.user) {
        return `Dr. ${doctor.user.first_name} ${doctor.user.last_name}`;
      }
    }
    if (typeof request.expected_with === 'object' && request.expected_with) {
      const user = request.expected_with as { first_name?: string; last_name?: string };
      return `Dr. ${user.first_name || ''} ${user.last_name || ''}`.trim();
    }
    return '';
  }

  getAppointmentTypeIcon(request: ConsultationRequest): string {
    return request.appointment?.type === 'online' ? 'videocam-outline' : 'location-outline';
  }

  getAppointmentTypeLabel(request: ConsultationRequest): string {
    return request.appointment?.type === 'online' ? 'Video' : 'In-person';
  }

  isStatusRequested(request: ConsultationRequest): boolean {
    return request.status?.toLowerCase() === 'requested';
  }

  isStatusAccepted(request: ConsultationRequest): boolean {
    return request.status?.toLowerCase() === 'accepted';
  }

  isStatusRefused(request: ConsultationRequest): boolean {
    return request.status?.toLowerCase() === 'refused';
  }

  getConsultationDoctorName(consultation: Consultation): string {
    if (consultation.owned_by) {
      return `Dr. ${consultation.owned_by.first_name} ${consultation.owned_by.last_name}`;
    }
    return '';
  }

  getConsultationReasonName(consultation: Consultation): string {
    if (consultation.title) {
      return consultation.title;
    }
    return 'Consultation';
  }

  viewConsultationDetails(consultation: Consultation): void {
    this.navCtrl.navigateForward(`/consultation/${consultation.id}`);
  }

  getConsultationStatusConfig(status: string): { label: string; color: 'warning' | 'info' | 'primary' | 'success' | 'muted' } {
    const normalizedStatus = (status || 'REQUESTED').toLowerCase();
    const statusMap: Record<string, { label: string; color: 'warning' | 'info' | 'primary' | 'success' | 'muted' }> = {
      'requested': { label: 'Requested', color: 'warning' },
      'active': { label: 'Active', color: 'success' },
      'closed': { label: 'Closed', color: 'muted' },
      'cancelled': { label: 'Cancelled', color: 'muted' }
    };
    return statusMap[normalizedStatus] || statusMap['requested'];
  }

  getUserInitials(): string {
    const user = this.currentUser();
    if (user) {
      const first = user.first_name?.charAt(0) || '';
      const last = user.last_name?.charAt(0) || '';
      return (first + last).toUpperCase() || 'U';
    }
    return 'U';
  }

  getUserPicture(): string {
    return this.currentUser()?.picture || '';
  }

  getAppointmentStatusConfig(status: string): { label: string; color: 'warning' | 'info' | 'primary' | 'success' | 'muted' } {
    const normalizedStatus = (status || 'draft').toLowerCase();
    const statusMap: Record<string, { label: string; color: 'warning' | 'info' | 'primary' | 'success' | 'muted' }> = {
      'draft': { label: 'Draft', color: 'warning' },
      'scheduled': { label: 'Scheduled', color: 'primary' },
      'cancelled': { label: 'Cancelled', color: 'muted' }
    };
    return statusMap[normalizedStatus] || statusMap['draft'];
  }

  getAppointmentDoctorName(appointment: Appointment): string {
    const currentUserId = this.currentUser()?.id;
    if (appointment.participants) {
      const doctor = appointment.participants.find(p => p.user && p.user.id !== currentUserId);
      if (doctor?.user) {
        return `Dr. ${doctor.user.first_name} ${doctor.user.last_name}`;
      }
    }
    return '';
  }

  getAppointmentIcon(appointment: Appointment): string {
    return appointment.type === 'online' ? 'videocam-outline' : 'location-outline';
  }

  getAppointmentTypeText(appointment: Appointment): string {
    return appointment.type === 'online' ? 'Video' : 'In-person';
  }

  viewAppointmentDetails(appointment: Appointment): void {
    this.navCtrl.navigateForward(`/appointment/${appointment.id}`);
  }
}
