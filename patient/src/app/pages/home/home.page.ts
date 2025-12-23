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
import { ConsultationRequest, Speciality } from '../../core/models/consultation.model';

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
  isLoading = signal(false);

  totalRequests = computed(() => this.requests().length);

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
    this.loadRequests();
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  ionViewWillEnter(): void {
    this.loadRequests();
  }

  loadUserData(): void {
    this.authService.currentUser$
      .pipe(takeUntil(this.destroy$))
      .subscribe(user => {
        this.currentUser.set(user);
      });
  }

  loadRequests(): void {
    this.isLoading.set(true);
    this.consultationService.getMyRequests()
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (requests) => {
          this.requests.set(requests);
          this.isLoading.set(false);
        },
        error: (error) => {
          this.showError(error?.error?.detail || 'Failed to load requests');
          this.isLoading.set(false);
        }
      });
  }

  refreshData(event: { target: { complete: () => void } }): void {
    this.consultationService.getMyRequests()
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (requests) => {
          this.requests.set(requests);
          event.target.complete();
        },
        error: (error) => {
          this.showError(error?.error?.detail || 'Failed to load requests');
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
    return request.appointment?.type === 'ONLINE' ? 'videocam-outline' : 'location-outline';
  }

  getAppointmentTypeLabel(request: ConsultationRequest): string {
    return request.appointment?.type === 'ONLINE' ? 'Video' : 'In-person';
  }

  isStatusRequested(request: ConsultationRequest): boolean {
    return request.status?.toLowerCase() === 'requested';
  }

  isStatusAccepted(request: ConsultationRequest): boolean {
    return request.status?.toLowerCase() === 'accepted';
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
}
