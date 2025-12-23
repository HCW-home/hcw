import { Component, OnInit, OnDestroy, signal } from '@angular/core';
import { CommonModule, DatePipe } from '@angular/common';
import { ActivatedRoute } from '@angular/router';
import {
  IonHeader,
  IonToolbar,
  IonButtons,
  IonButton,
  IonIcon,
  IonBackButton,
  IonContent,
  IonSpinner,
  NavController,
  ToastController
} from '@ionic/angular/standalone';
import { Subject, takeUntil } from 'rxjs';
import { ConsultationService } from '../../core/services/consultation.service';
import { ConsultationRequest, Speciality } from '../../core/models/consultation.model';

interface RequestStatus {
  label: string;
  color: 'warning' | 'info' | 'primary' | 'success' | 'muted';
}

@Component({
  selector: 'app-request-detail',
  templateUrl: './request-detail.page.html',
  styleUrls: ['./request-detail.page.scss'],
  standalone: true,
  imports: [
    CommonModule,
    DatePipe,
    IonHeader,
    IonToolbar,
    IonButtons,
    IonButton,
    IonIcon,
    IonBackButton,
    IonContent,
    IonSpinner
  ]
})
export class RequestDetailPage implements OnInit, OnDestroy {
  private destroy$ = new Subject<void>();
  private requestId: number | null = null;

  request = signal<ConsultationRequest | null>(null);
  isLoading = signal(true);

  constructor(
    private route: ActivatedRoute,
    private navCtrl: NavController,
    private consultationService: ConsultationService,
    private toastController: ToastController
  ) {}

  ngOnInit(): void {
    this.route.params.pipe(takeUntil(this.destroy$)).subscribe(params => {
      this.requestId = +params['id'];
      this.loadRequest();
    });
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  private loadRequest(): void {
    if (!this.requestId) return;

    this.isLoading.set(true);
    this.consultationService.getRequestById(this.requestId)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (request) => {
          this.request.set(request);
          this.isLoading.set(false);
        },
        error: async (error) => {
          this.isLoading.set(false);
          const toast = await this.toastController.create({
            message: error?.error?.detail || 'Failed to load request details',
            duration: 3000,
            position: 'bottom',
            color: 'danger'
          });
          await toast.present();
        }
      });
  }

  goBack(): void {
    this.navCtrl.back();
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

  hasAppointment(): boolean {
    return !!this.request()?.appointment;
  }

  hasConsultation(): boolean {
    return !!this.request()?.consultation;
  }

  getReasonName(): string {
    const req = this.request();
    if (req && typeof req.reason === 'object' && req.reason) {
      return req.reason.name;
    }
    return 'Consultation';
  }

  getSpecialityName(): string {
    const req = this.request();
    if (req && typeof req.reason === 'object' && req.reason) {
      const speciality = req.reason.speciality;
      if (typeof speciality === 'object' && speciality) {
        return (speciality as Speciality).name;
      }
    }
    return '';
  }

  getDoctorName(): string {
    const req = this.request();
    if (!req) return '';

    if (req.appointment?.participants) {
      const doctor = req.appointment.participants.find(p => p.user && p.user.id !== req.created_by?.id);
      if (doctor?.user) {
        return `Dr. ${doctor.user.first_name} ${doctor.user.last_name}`;
      }
    }
    if (typeof req.expected_with === 'object' && req.expected_with) {
      const user = req.expected_with as { first_name?: string; last_name?: string };
      return `Dr. ${user.first_name || ''} ${user.last_name || ''}`.trim();
    }
    return '';
  }

  getAppointmentTypeIcon(): string {
    return this.request()?.appointment?.type === 'ONLINE' ? 'videocam-outline' : 'location-outline';
  }

  getAppointmentTypeLabel(): string {
    return this.request()?.appointment?.type === 'ONLINE' ? 'Video Consultation' : 'In-person Visit';
  }

  getTypeLabel(): string {
    return this.request()?.type === 'ONLINE' ? 'Video Consultation' : 'In-person Visit';
  }

  isStatusRequested(): boolean {
    return this.request()?.status?.toLowerCase() === 'requested';
  }

  isStatusAccepted(): boolean {
    return this.request()?.status?.toLowerCase() === 'accepted';
  }

  isStatusRefused(): boolean {
    return this.request()?.status?.toLowerCase() === 'refused';
  }

  viewConsultation(): void {
    const req = this.request();
    if (req?.consultation) {
      const consultationId = typeof req.consultation === 'object' ? req.consultation.id : req.consultation;
      this.navCtrl.navigateForward(`/consultation/${consultationId}`);
    }
  }

  joinAppointment(): void {
    const req = this.request();
    if (req?.appointment) {
      this.navCtrl.navigateForward(`/consultation/${req.appointment.consultation}/video`);
    }
  }

  async cancelRequest(): Promise<void> {
    const req = this.request();
    if (!req?.id) return;

    this.consultationService.cancelConsultationRequest(req.id)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: async () => {
          const toast = await this.toastController.create({
            message: 'Request cancelled successfully',
            duration: 3000,
            position: 'bottom',
            color: 'success'
          });
          await toast.present();
          this.navCtrl.back();
        },
        error: async (error) => {
          const toast = await this.toastController.create({
            message: error?.error?.detail || 'Failed to cancel request',
            duration: 3000,
            position: 'bottom',
            color: 'danger'
          });
          await toast.present();
        }
      });
  }
}
