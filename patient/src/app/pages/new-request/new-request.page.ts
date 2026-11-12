import { Component, OnInit, OnDestroy, signal, computed, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import {
  IonContent,
  IonButton,
  IonIcon,
  IonCardContent,
  IonSpinner,
  IonTextarea,
  AlertController,
  NavController,
  ToastController,
  ViewWillEnter
} from '@ionic/angular/standalone';
import { TranslatePipe } from '@ngx-translate/core';
import { Subject, takeUntil, forkJoin } from 'rxjs';
import { TranslationService } from '../../core/services/translation.service';
import { SpecialityService } from '../../core/services/speciality.service';
import { DoctorService } from '../../core/services/doctor.service';
import { ConsultationService, ConsultationRequestData } from '../../core/services/consultation.service';
import { AuthService } from '../../core/services/auth.service';
import { PractitionerSearchService } from '../../core/services/practitioner-search.service';
import { Speciality, Doctor } from '../../core/models/doctor.model';
import { Reason, Slot, CustomField } from '../../core/models/consultation.model';
import { BookingIntent, SearchItem, SearchQuery } from '../../core/models/search.model';
import { AppHeaderComponent } from '../../shared/app-header/app-header.component';
import { AppFooterComponent } from '../../shared/app-footer/app-footer.component';
import { SearchBarComponent } from '../../shared/components/search-bar/search-bar.component';
import { SearchMapComponent } from '../../shared/components/search-map/search-map.component';
import { SearchResultCardComponent } from '../../shared/components/search-result-card/search-result-card.component';

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
    IonButton,
    IonIcon,
    IonCardContent,
    IonSpinner,
    IonTextarea,
    AppHeaderComponent,
    AppFooterComponent,
    SearchBarComponent,
    SearchMapComponent,
    SearchResultCardComponent,
    TranslatePipe
  ]
})
export class NewRequestPage implements OnInit, OnDestroy, ViewWillEnter {
  private destroy$ = new Subject<void>();
  private t = inject(TranslationService);

  currentStep = signal(1);
  totalSteps = 6;
  isLoading = signal(false);
  isSubmitting = signal(false);
  registrationEnabled = signal(false);

  selectedSpeciality = signal<Speciality | null>(null);

  // The first step is a directory search: patients look for a practitioner,
  // a facility or a speciality, then pick a slot from the results.
  hasSearched = signal(false);
  isSearching = signal(false);
  searchResults = signal<SearchItem[]>([]);
  selectedItemId = signal<string | null>(null);
  // Prefill for a search started from the dashboard.
  initialWho = '';
  initialWhere = '';

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
  private visitedDoctorStep = false;
  private initializedOnce = false;

  stepTitle = computed(() => {
    switch (this.currentStep()) {
      case 1: return this.t.instant('map.searchTitle');
      case 2: return this.t.instant('newRequest.selectReason');
      case 3: return this.t.instant('newRequest.selectDoctor');
      case 4: return this.t.instant('newRequest.chooseTimeSlot');
      case 5: return this.t.instant('newRequest.signInToContinue');
      case 6: return this.t.instant('newRequest.reviewAndSubmit');
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
    private alertCtrl: AlertController,
    private route: ActivatedRoute,
    private router: Router,
    private specialityService: SpecialityService,
    private doctorService: DoctorService,
    private consultationService: ConsultationService,
    private authService: AuthService,
    private searchService: PractitionerSearchService,
  ) {}

  ngOnInit() {
    this.initializedOnce = true;

    if (this.tryRestoreDraft()) {
      return;
    }

    const params = this.route.snapshot.queryParamMap;
    const doctorId = Number(this.readParam(params, 'doctor_id'));
    const specialityId = Number(this.readParam(params, 'speciality_id'));

    if (doctorId && specialityId) {
      this.startBooking(doctorId, specialityId, this.slotFromParams(params, doctorId));
      return;
    }

    // Coming from the dashboard: the terms were typed there, run them here.
    this.initialWho = this.readParam(params, 'who');
    this.initialWhere = this.readParam(params, 'where');
    if (this.initialWho || this.initialWhere) {
      this.onSearch({ who: this.initialWho, where: this.initialWhere });
    }
  }

  // Query params are whatever the URL holds: a hand-edited or stale link can
  // carry a literal "undefined", which must not be taken for a value.
  private readParam(params: import('@angular/router').ParamMap, name: string): string {
    const value = params.get(name) ?? '';
    return value === 'undefined' || value === 'null' ? '' : value;
  }

  ionViewWillEnter(): void {
    if (!this.initializedOnce) {
      return;
    }
    this.tryRestoreDraft();
  }

  ngOnDestroy() {
    this.destroy$.next();
    this.destroy$.complete();
  }

  private slotFromParams(params: import('@angular/router').ParamMap, doctorId: number): Slot | null {
    const slotDate = this.readParam(params, 'slot_date');
    const slotTime = this.readParam(params, 'slot_time');
    if (!slotDate || !slotTime) {
      return null;
    }
    const duration = Number(this.readParam(params, 'slot_duration')) || 0;
    return {
      date: slotDate,
      start_time: slotTime,
      end_time: this.computeEndTime(slotTime, duration),
      duration,
      user_id: doctorId,
    } as Slot;
  }

  /**
   * Enters the wizard on a known practitioner — from a deep link out of the map
   * or from the search on the first step. The speciality is already settled, so
   * the flow resumes at the reason step; a slot picked upfront is replayed once
   * the reason confirms it lasts as long.
   */
  private startBooking(doctorId: number, specialityId: number, slot: Slot | null): void {
    this.isLoading.set(true);

    forkJoin({
      specialities: this.specialityService.getSpecialities(),
      doctor: this.doctorService.getPublicPractitioner(doctorId),
    }).pipe(takeUntil(this.destroy$)).subscribe({
      next: ({ specialities, doctor }) => {
        const doctorSpecialities = doctor.specialities ?? [];

        const filteredSpecialities = doctorSpecialities.length > 0
          ? doctorSpecialities.filter(s => s.id === specialityId)
          : specialities.filter(s => s.id === specialityId);

        this.selectedSpeciality.set(filteredSpecialities[0] ?? null);

        this.selectedDoctor.set(doctor);
        this.pendingSlot = slot;

        this.loadReasons(specialityId);
        this.currentStep.set(2);
        this.isLoading.set(false);
      },
      error: () => {
        this.showToast(this.t.instant('newRequest.failedSpecialties'), 'danger');
        this.isLoading.set(false);
      }
    });
  }

  // ---------------------------------------------------------------------------
  // Directory search (step 1)
  // ---------------------------------------------------------------------------

  onSearch(query: SearchQuery): void {
    this.hasSearched.set(true);
    this.isSearching.set(true);
    this.selectedItemId.set(null);
    this.searchService.search(query)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (items) => {
          this.searchResults.set(items);
          this.isSearching.set(false);
        },
        error: () => {
          this.searchResults.set([]);
          this.isSearching.set(false);
        }
      });
  }

  clearSearch(): void {
    this.hasSearched.set(false);
    this.searchResults.set([]);
    this.selectedItemId.set(null);
  }

  isSelected(item: SearchItem): boolean {
    return this.selectedItemId() === item.id;
  }

  onMarkerSelected(item: SearchItem): void {
    this.selectedItemId.set(item.id);
  }

  // A result with no slot context yet: fall back to the practitioner's first
  // speciality, which is the one the wizard will offer reasons for.
  startBookingWithPractitioner(item: SearchItem): void {
    this.startBookingWithIntent({ item, specialityId: null, slot: null });
  }

  startBookingWithIntent(intent: BookingIntent): void {
    const doctor = intent.item.doctor;
    if (!doctor) {
      return;
    }

    const specialityId = intent.specialityId ?? doctor.specialities?.[0]?.id ?? null;
    if (!specialityId) {
      this.showToast(this.t.instant('newRequest.noSpecialties'), 'warning');
      return;
    }

    this.startBooking(doctor.pk, specialityId, intent.slot);
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
    if (pending && !reason.skip_doctor_selection && pending.duration === reason.duration) {
      this.selectedSlot.set(pending);
      this.pendingSlot = null;
      this.proceedToRecapOrAuth();
      return;
    }
    this.pendingSlot = null;

    if (reason.assignment_method !== 'appointment') {
      this.selectedSlot.set(null);
      this.proceedToRecapOrAuth();
      return;
    }

    if (reason.skip_doctor_selection || this.selectedDoctor()) {
      this.visitedDoctorStep = false;
      this.loadAvailableSlots(reason.id);
      this.currentStep.set(4);
    } else {
      this.visitedDoctorStep = true;
      this.loadDoctors();
      this.currentStep.set(3);
    }
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

  proceedWithDoctor(): void {
    const reason = this.selectedReason();
    if (reason) {
      this.loadAvailableSlots(reason.id);
      this.currentStep.set(4);
    }
  }

  skipDoctorSelection(): void {
    this.selectedDoctor.set(null);
    this.proceedWithDoctor();
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
      this.currentStep.set(5);
      this.authService.getConfig().subscribe({
        next: (config: any) => {
          if (!config) return;
          this.registrationEnabled.set(!!config.registration_enabled && !config.force_temporary_patients);
        },
      });
      return;
    }
    this.currentStep.set(6);
  }

  goToLogin(): void {
    this.saveDraftAndRedirect('/login');
  }

  goToRegister(): void {
    this.saveDraftAndRedirect('/register');
  }

  private saveDraftAndRedirect(path: string): void {
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
    } catch {
    }
    this.router.navigate([path], { queryParams: { action: 'completeBooking' } });
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
      this.currentStep.set(6);
      return true;
    } catch {
      try { sessionStorage.removeItem(BOOKING_DRAFT_KEY); } catch { }
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
        // Results are a state of the first step, not a step of their own:
        // going back drops them and shows the speciality grid again.
        if (this.hasSearched()) {
          this.clearSearch();
        } else {
          this.navCtrl.back();
        }
        break;
      case 2:
        this.currentStep.set(1);
        break;
      case 3:
        this.currentStep.set(2);
        break;
      case 4:
        this.currentStep.set(this.visitedDoctorStep ? 3 : 2);
        break;
      case 5: 
        this.currentStep.set(4);
        break;
      case 6: {
        const reason = this.selectedReason();
        if (reason && reason.assignment_method === 'appointment') {
          this.currentStep.set(4);
        } else {
          this.currentStep.set(2);
        }
        break;
      }
    }
  }

  async confirmCancel(): Promise<void> {
    const alert = await this.alertCtrl.create({
      header: this.t.instant('newRequest.cancelConfirmTitle'),
      message: this.t.instant('newRequest.cancelConfirmMessage'),
      buttons: [
        { text: this.t.instant('newRequest.cancelConfirmStay'), role: 'cancel' },
        {
          text: this.t.instant('newRequest.cancelConfirmLeave'),
          role: 'destructive',
          handler: () => this.exitWizard(),
        },
      ],
    });
    await alert.present();
  }

  // Drop the draft too, otherwise ionViewWillEnter would restore the wizard on
  // the review step the next time the page is opened.
  private exitWizard(): void {
    try {
      sessionStorage.removeItem(BOOKING_DRAFT_KEY);
    } catch {
    }
    this.navCtrl.navigateBack(this.authService.isAuthenticatedValue ? '/home' : '/map');
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
      this.saveDraftAndRedirect("/login");
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