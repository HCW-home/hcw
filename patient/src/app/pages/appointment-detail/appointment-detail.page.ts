import { Component, OnInit, OnDestroy, signal, computed } from '@angular/core';
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
import { AuthService } from '../../core/services/auth.service';
import { Appointment, User } from '../../core/models/consultation.model';

interface StatusConfig {
  label: string;
  color: 'warning' | 'info' | 'primary' | 'success' | 'muted';
}

@Component({
  selector: 'app-appointment-detail',
  templateUrl: './appointment-detail.page.html',
  styleUrls: ['./appointment-detail.page.scss'],
  imports: [
    CommonModule,
    DatePipe,
    IonHeader,
    IonToolbar,
    IonButtons,
    IonIcon,
    IonBackButton,
    IonContent,
    IonSpinner
  ]
})
export class AppointmentDetailPage implements OnInit, OnDestroy {
  private destroy$ = new Subject<void>();
  private appointmentId: number | null = null;

  appointment = signal<Appointment | null>(null);
  isLoading = signal(true);
  isCancelling = signal(false);
  currentUser = signal<User | null>(null);

  doctorName = computed(() => {
    const apt = this.appointment();
    const currentUserId = this.currentUser()?.id;
    if (apt?.participants) {
      const doctor = apt.participants.find(p => p.user && p.user.id !== currentUserId);
      if (doctor?.user) {
        return `Dr. ${doctor.user.first_name} ${doctor.user.last_name}`;
      }
    }
    return '';
  });

  doctorInitial = computed(() => {
    const name = this.doctorName();
    if (name) {
      const parts = name.replace('Dr. ', '').split(' ');
      return parts[0]?.charAt(0)?.toUpperCase() || '?';
    }
    return '?';
  });

  isScheduled = computed(() => this.appointment()?.status === 'scheduled');
  isCancelled = computed(() => this.appointment()?.status === 'cancelled');
  isOnline = computed(() => this.appointment()?.type === 'online');

  constructor(
    private route: ActivatedRoute,
    private navCtrl: NavController,
    private consultationService: ConsultationService,
    private authService: AuthService,
    private toastController: ToastController
  ) {}

  ngOnInit(): void {
    this.loadCurrentUser();
    this.route.params.pipe(takeUntil(this.destroy$)).subscribe(params => {
      this.appointmentId = +params['id'];
      this.loadAppointment();
    });
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  private loadCurrentUser(): void {
    this.authService.currentUser$
      .pipe(takeUntil(this.destroy$))
      .subscribe(user => {
        if (user) {
          this.currentUser.set(user as User);
        }
      });
  }

  private loadAppointment(): void {
    if (!this.appointmentId) return;

    this.isLoading.set(true);
    this.consultationService.getAppointmentById(this.appointmentId)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (appointment) => {
          this.appointment.set(appointment);
          this.isLoading.set(false);
        },
        error: async () => {
          this.isLoading.set(false);
          const toast = await this.toastController.create({
            message: 'Failed to load appointment details',
            duration: 3000,
            position: 'bottom',
            color: 'danger'
          });
          await toast.present();
        }
      });
  }

  getStatusConfig(status: string | undefined): StatusConfig {
    const normalizedStatus = (status || 'draft').toLowerCase();
    const statusMap: Record<string, StatusConfig> = {
      'draft': { label: 'Draft', color: 'warning' },
      'scheduled': { label: 'Scheduled', color: 'primary' },
      'cancelled': { label: 'Cancelled', color: 'muted' }
    };
    return statusMap[normalizedStatus] || statusMap['draft'];
  }

  getTypeIcon(): string {
    return this.appointment()?.type === 'online' ? 'videocam-outline' : 'location-outline';
  }

  getTypeLabel(): string {
    return this.appointment()?.type === 'online' ? 'Video Consultation' : 'In-person Visit';
  }

  joinVideoCall(): void {
    const apt = this.appointment();
    if (!apt) return;
    let url = `/consultation/${apt.id}/video?type=appointment`;
    if (apt.consultation_id) {
      url += `&consultationId=${apt.consultation_id}`;
    }
    this.navCtrl.navigateForward(url);
  }

  viewConsultation(): void {
    const apt = this.appointment();
    if (apt?.consultation_id) {
      this.navCtrl.navigateForward(`/consultation/${apt.consultation_id}`);
    }
  }

  getParticipants(): { name: string; isConfirmed: boolean }[] {
    const apt = this.appointment();
    if (!apt?.participants) return [];
    return apt.participants.map(p => ({
      name: p.user
        ? `${p.user.first_name} ${p.user.last_name}`
        : `${p.first_name || ''} ${p.last_name || p.email || ''}`.trim(),
      isConfirmed: p.is_confirmed
    }));
  }
}
