import { Component, OnInit, OnDestroy, signal, computed, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import {
  IonContent,
  IonHeader,
  IonTitle,
  IonToolbar,
  IonButtons,
  IonButton,
  IonIcon,
  IonCardContent,
  IonSpinner,
  IonTextarea,
  IonProgressBar,
  NavController,
  ToastController
} from '@ionic/angular/standalone';
import { TranslatePipe } from '@ngx-translate/core';
import { Subject, takeUntil, forkJoin } from 'rxjs';
import { TranslationService } from '../../core/services/translation.service';
import { SpecialityService } from '../../core/services/speciality.service';
import { DoctorService } from '../../core/services/doctor.service';
import { ConsultationService, ConsultationRequestData } from '../../core/services/consultation.service';
import { AuthService } from '../../core/services/auth.service';
import { Speciality, Doctor } from '../../core/models/doctor.model';
import { Reason, Slot, CustomField } from '../../core/models/consultation.model';
import { LocalDatePipe } from '../../shared/pipes/local-date.pipe';

const BOOKING_DRAFT_KEY = 'hcw_booking_draft';

interface BookingDraft {
  speciality: Speciality | null;
  doctor: Doctor | null;
  reason: Reason | null;
  slot: Slot | null;
  customFieldValues: Record<number, string>;
  comment: string;
}

@Component({
  selector: 'app-new-request',
  templateUrl: './new-request.page.html',
  styleUrls: ['./new-request.page.scss'],
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    IonContent,
    IonHeader,
    IonTitle,
    IonToolbar,
    IonButtons,
    IonButton,
    IonIcon,
    IonCardContent,
    IonSpinner,
    IonTextarea,
    IonProgressBar,
    TranslatePipe,
    LocalDatePipe
  ]
})
export class NewRequestPage implements OnInit, OnDestroy {
  private destroy$ = new Subject<void>();
  private t = inject(TranslationService);

  currentStep = signal(1);
  totalSteps = 5;
  isLoading = signal(false);
  isSubmitting = signal(false);

  specialities = signal<Speciality[]>([]);
  selectedSpeciality = signal<Speciality | null>(null);

  reasons = signal<Reason[]>([]);
  selectedReason = signal<Reason | null>(null);

  availableSlots = signal<Slot[]>([]);
  selectedSlot = signal<Slot | null>(null);
  currentWeekStart = signal<Date>(this.getStartOfWeek(new Date()));

  doctors = signal<Doctor[]>([]);
  selectedDoctor = signal<Doctor | null>(null);

  customFields = signal<CustomField[]>([]);
  customFieldValues: Record<number, string> = {};

  comment = '';
  
  private pendingSlot: Slot | null = null;

  stepTitle = computed(() => {
    switch (this.currentStep()) {
      case 1: return this.t.instant('newRequest.selectSpecialty');
      case 2: return this.t.instant('newRequest.selectDoctor');
      case 3: return this.t.instant('newRequest.selectReason');
      case 4: return this.t.instant('newRequest.chooseTimeSlot');
      case 5: return this.t.instant('newRequest.reviewAndSubmit');
      default: return this.t.instant('newRequest.newRequest');
    }
  });

  progress = computed(() => this.currentStep() / this.totalSteps);

  groupedSlots = computed(() => {
    const slots = this.availableSlots();
    const grouped: { [date: string]: Slot[] } = {};
    slots.forEach(slot => {
      if (!grouped[slot.date]) {
        grouped[slot.date] = [];
      }
      grouped[slot.date].push(slot);
    });
    return grouped;
  });

  weekDates = computed(() => {
    const start = this.currentWeekStart();
    const dates: Date[] = [];
    for (let i = 0; i < 15; i++) {
      const date = new Date(start);
      date.setDate(start.getDate() + i);
      dates.push(date);
    }
    return dates;
  });

  canGoPreviousWeek = computed(() => {
    const current = this.currentWeekStart();
    const prev = new Date(current);
    prev.setDate(current.getDate() - 15);
    const today = this.getStartOfWeek(new Date());
    return prev >= today;
  });

  constructor(
    private navCtrl: NavController,
    private toastCtrl: ToastController,
    private route: ActivatedRoute,
    private router: Router,
    private specialityService: SpecialityService,
    private doctorService: DoctorService,
    private consultationService: ConsultationService,
    private authService: AuthService,
  ) {}

  ngOnInit() {
    if (this.tryRestoreDraft()) {
      return;
    }

    const params = this.route.snapshot.queryParamMap;
    const doctorId = params.get('doctor_id');
    const specialityId = params.get('speciality_id');

    if (doctorId && specialityId) {
      this.initFromQueryParams(Number(doctorId), Number(specialityId), params);
      return;
    }

    this.loadSpecialities();
  }

  ngOnDestroy() {
    this.destroy$.next();
    this.destroy$.complete();
  }

  private initFromQueryParams(doctorId: number, specialityId: number, params: import('@angular/router').ParamMap): void {
    this.isLoading.set(true);

    forkJoin({
      specialities: this.specialityService.getSpecialities(),
      doctor: this.doctorService.getPublicPractitioner(doctorId),
    }).pipe(takeUntil(this.destroy$)).subscribe({
      next: ({ specialities, doctor }) => {
        this.specialities.set(specialities);
        const speciality = specialities.find(s => s.id === specialityId) ?? null;
        this.selectedSpeciality.set(speciality);
        this.selectedDoctor.set(doctor);

        const slotDate = params.get('slot_date');
        const slotTime = params.get('slot_time');
        const slotDurationRaw = params.get('slot_duration');
        if (slotDate && slotTime) {
          const duration = slotDurationRaw ? Number(slotDurationRaw) : 0;
          this.pendingSlot = {
            date: slotDate,
            start_time: slotTime,
            end_time: this.computeEndTime(slotTime, duration),
            duration,
            user_id: doctorId,
          } as Slot;
        }

        this.loadReasons(specialityId);
        this.currentStep.set(3);
        this.isLoading.set(false);
      },
      error: () => {
        this.isLoading.set(false);
        this.loadSpecialities();
      }
    });
  }

  loadSpecialities(): void {
    this.isLoading.set(true);
    this.specialityService.getSpecialities()
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (specialities) => {
          this.specialities.set(specialities);
          this.isLoading.set(false);
        },
        error: () => {
          this.showToast(this.t.instant('newRequest.failedSpecialties'), 'danger');
          this.isLoading.set(false);
        }
      });
  }

  selectSpeciality(speciality: Speciality): void {
    this.selectedSpeciality.set(speciality);
    this.loadDoctors();
    this.currentStep.set(2);
  }

  private loadDoctors(): void {
    const speciality = this.selectedSpeciality();
    if (!speciality) return;

    this.isLoading.set(true);
    this.doctorService.getDoctorsBySpeciality(speciality.id)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (doctors) => {
          this.doctors.set(doctors);
          this.isLoading.set(false);
        },
        error: () => {
          this.showToast(this.t.instant('newRequest.failedDoctors'), 'danger');
          this.isLoading.set(false);
        }
      });
  }

  selectDoctor(doctor: Doctor): void {
    this.selectedDoctor.set(doctor);
  }

  proceedToReason(): void {
    const speciality = this.selectedSpeciality();
    if (speciality) {
      this.loadReasons(speciality.id);
      this.currentStep.set(3);
    }
  }

  skipDoctorSelection(): void {
    this.selectedDoctor.set(null);
    this.proceedToReason();
  }

  isDoctorSelected(doctor: Doctor): boolean {
    const selected = this.selectedDoctor();
    if (!selected || !doctor) {
      return false;
    }
    const selectedId = (selected as any).pk ?? selected.id;
    const doctorId = (doctor as any).pk ?? doctor.id;
    return selectedId === doctorId;
  }

  getDoctorFullName(doctor: Doctor): string {
    return `Dr. ${doctor.first_name} ${doctor.last_name}`;
  }

  loadReasons(specialityId: number): void {
    this.isLoading.set(true);
    this.specialityService.getReasonsBySpeciality(specialityId)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (reasons) => {
          this.reasons.set(reasons);
          this.isLoading.set(false);
        },
        error: () => {
          this.showToast(this.t.instant('newRequest.failedReasons'), 'danger');
          this.isLoading.set(false);
        }
      });
  }

  selectReason(reason: Reason): void {
    this.selectedReason.set(reason);

    if (reason.skip_doctor_selection) {
      this.selectedDoctor.set(null);
    }

    const pending = this.pendingSlot;
    if (pending && pending.duration === reason.duration) {
      this.selectedSlot.set(pending);
      this.pendingSlot = null;
      this.proceedToRecapOrAuth();
      return;
    }
    this.pendingSlot = null;

    if (reason.assignment_method === 'appointment') {
      this.selectedSlot.set(null);
      this.loadAvailableSlots(reason.id);
      this.currentStep.set(4);
    } else {
      this.selectedSlot.set(null);
      this.proceedToRecapOrAuth();
    }
  }

  loadAvailableSlots(reasonId: number): void {
    this.isLoading.set(true);
    const fromDate = this.formatDate(this.currentWeekStart());
    const params: { from_date: string; user_id?: number } = { from_date: fromDate };
    const doctor = this.selectedDoctor();
    if (doctor) {
      params.user_id = (doctor as any).pk ?? doctor.id;
    }
    this.doctorService.getAvailableSlots(reasonId, params)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (slots) => {
          this.availableSlots.set(slots);
          this.isLoading.set(false);
        },
        error: () => {
          this.showToast(this.t.instant('newRequest.failedSlots'), 'danger');
          this.isLoading.set(false);
        }
      });
  }

  selectSlot(slot: Slot): void {
    this.selectedSlot.set(slot);
  }

  nextWeek(): void {
    const current = this.currentWeekStart();
    const next = new Date(current);
    next.setDate(current.getDate() + 15);
    this.currentWeekStart.set(next);
    const reason = this.selectedReason();
    if (reason) {
      this.loadAvailableSlots(reason.id);
    }
  }

  previousWeek(): void {
    const current = this.currentWeekStart();
    const prev = new Date(current);
    prev.setDate(current.getDate() - 15);
    const today = this.getStartOfWeek(new Date());
    if (prev >= today) {
      this.currentWeekStart.set(prev);
      const reason = this.selectedReason();
      if (reason) {
        this.loadAvailableSlots(reason.id);
      }
    }
  }

  proceedToRecapOrAuth(): void {
    this.loadCustomFields();
    if (!this.authService.isAuthenticatedValue) {
      this.saveDraftAndRedirectToLogin();
      return;
    }
    this.currentStep.set(5);
  }

  private saveDraftAndRedirectToLogin(): void {
    const draft: BookingDraft = {
      speciality: this.selectedSpeciality(),
      doctor: this.selectedDoctor(),
      reason: this.selectedReason(),
      slot: this.selectedSlot(),
      customFieldValues: this.customFieldValues,
      comment: this.comment,
    };
    try {
      sessionStorage.setItem(BOOKING_DRAFT_KEY, JSON.stringify(draft));
    } catch {}
    this.router.navigate(['/login'], { queryParams: { action: 'completeBooking' } });
  }

  private tryRestoreDraft(): boolean {
    let raw: string | null = null;
    try {
      raw = sessionStorage.getItem(BOOKING_DRAFT_KEY);
    } catch {
      return false;
    }
    if (!raw) return false;

    try {
      const draft: BookingDraft = JSON.parse(raw);
      this.selectedSpeciality.set(draft.speciality ?? null);
      this.selectedDoctor.set(draft.doctor ?? null);
      this.selectedReason.set(draft.reason ?? null);
      this.selectedSlot.set(draft.slot ?? null);
      this.customFieldValues = draft.customFieldValues ?? {};
      this.comment = draft.comment ?? '';
      sessionStorage.removeItem(BOOKING_DRAFT_KEY);
      this.loadCustomFields();
      this.currentStep.set(5);
      return true;
    } catch {
      try { sessionStorage.removeItem(BOOKING_DRAFT_KEY); } catch { /* noop */ }
      return false;
    }
  }

  loadCustomFields(): void {
    const fields = this.selectedReason()?.custom_fields ?? [];
    this.customFields.set(fields);
  }

  goBack(): void {
    const step = this.currentStep();
    switch (step) {
      case 1:
        this.navCtrl.back();
        break;
      case 2:
        this.currentStep.set(1);
        break;
      case 3:
        this.currentStep.set(2);
        break;
      case 4:
        this.currentStep.set(3);
        break;
      case 5: {
        const reason = this.selectedReason();
        if (reason && reason.assignment_method === 'appointment') {
          this.currentStep.set(4);
        } else {
          this.currentStep.set(3);
        }
        break;
      }
    }
  }

  async submitRequest(): Promise<void> {
    const reason = this.selectedReason();
    const slot = this.selectedSlot();
    const doctor = this.selectedDoctor();

    if (!reason) {
      this.showToast(this.t.instant('newRequest.selectReasonWarning'), 'warning');
      return;
    }

    if (!this.authService.isAuthenticatedValue) {
      this.saveDraftAndRedirectToLogin();
      return;
    }

    let expectedAt: string;
    if (slot) {
      expectedAt = `${slot.date}T${slot.start_time}`;
    } else {
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      tomorrow.setHours(9, 0, 0, 0);
      expectedAt = tomorrow.toISOString();
    }

    const requestData: ConsultationRequestData = {
      reason_id: reason.id,
      expected_at: expectedAt,
      type: 'online',
      comment: this.comment.trim() || ''
    };

    if (doctor) {
      requestData.expected_with_id = (doctor as any).pk ?? doctor.id;
    }

    const cfPayload = Object.entries(this.customFieldValues)
      .filter(([_, value]) => value !== '' && value !== null && value !== undefined)
      .map(([fieldId, value]) => ({ field: parseInt(fieldId, 10), value }));
    if (cfPayload.length > 0) {
      requestData.custom_fields = cfPayload;
    }

    this.isSubmitting.set(true);
    this.consultationService.createConsultationRequest(requestData)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (createdRequest) => {
          this.showToast(this.t.instant('newRequest.submitSuccess'), 'success');
          const requestId = (createdRequest as any).pk ?? (createdRequest as any).id;
          this.navCtrl.navigateBack('/home', {
            queryParams: { highlightRequest: requestId }
          });
        },
        error: () => {
          this.showToast(this.t.instant('newRequest.submitFailed'), 'danger');
          this.isSubmitting.set(false);
        }
      });
  }

  private getStartOfWeek(date: Date): Date {
    const d = new Date(date);
    const day = d.getDay();
    const diff = d.getDate() - day + (day === 0 ? -6 : 1);
    d.setDate(diff);
    d.setHours(0, 0, 0, 0);
    return d;
  }

  private formatDate(date: Date): string {
    const y = date.getFullYear();
    const m = (date.getMonth() + 1).toString().padStart(2, '0');
    const d = date.getDate().toString().padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  private computeEndTime(startTime: string, durationMinutes: number): string {
    const [h, m] = startTime.split(':').map(Number);
    const total = h * 60 + m + durationMinutes;
    const eh = Math.floor(total / 60) % 24;
    const em = total % 60;
    return `${eh.toString().padStart(2, '0')}:${em.toString().padStart(2, '0')}:00`;
  }

  formatDisplayDate(date: Date): string {
    return date.toLocaleDateString(this.t.currentLanguage(), { weekday: 'short', month: 'short', day: 'numeric' });
  }

  formatDayName(date: Date): string {
    return date.toLocaleDateString(this.t.currentLanguage(), { weekday: 'short' });
  }

  formatDayNumber(date: Date): string {
    return date.getDate().toString();
  }

  isToday(date: Date): boolean {
    const today = new Date();
    return date.getDate() === today.getDate() &&
           date.getMonth() === today.getMonth() &&
           date.getFullYear() === today.getFullYear();
  }

  isPastDate(date: Date): boolean {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const d = new Date(date);
    d.setHours(0, 0, 0, 0);
    return d < today;
  }

  formatSlotTime(slot: Slot): string {
    return `${slot.start_time.substring(0, 5)} - ${slot.end_time.substring(0, 5)}`;
  }

  getSlotsForDate(date: Date): Slot[] {
    const dateStr = this.formatDate(date);
    return this.groupedSlots()[dateStr] || [];
  }

  isSlotSelected(slot: Slot): boolean {
    const selected = this.selectedSlot();
    return selected !== null &&
      selected.date === slot.date &&
      selected.start_time === slot.start_time &&
      selected.user_id === slot.user_id;
  }

  getExpectedDateTime(): string {
    const slot = this.selectedSlot();
    if (slot) {
      const date = new Date(`${slot.date}T${slot.start_time}`);
      return date.toLocaleString(this.t.currentLanguage(), {
        weekday: 'short',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      });
    }
    return this.t.instant('newRequest.notSelectedSystemAssign');
  }

  private async showToast(message: string, color: string = 'primary'): Promise<void> {
    const toast = await this.toastCtrl.create({
      message,
      duration: 2000,
      color
    });
    toast.present();
  }
}