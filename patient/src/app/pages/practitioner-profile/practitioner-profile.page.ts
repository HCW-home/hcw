import { Component, OnInit, OnDestroy, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import {
  IonContent,
  IonSpinner,
  IonIcon,
  NavController,
  IonButton,
} from '@ionic/angular/standalone';
import { TranslatePipe } from '@ngx-translate/core';
import { Subject, forkJoin, of, takeUntil } from 'rxjs';
import { catchError, map as rxMap } from 'rxjs/operators';
import { ApiService } from '../../core/services/api.service';
import { AppHeaderComponent } from '../../shared/app-header/app-header.component';
import { AppFooterComponent } from '../../shared/app-footer/app-footer.component';
import { LocalDatePipe } from '../../shared/pipes/local-date.pipe';
import { DoctorService, Reason } from '../../core/services/doctor.service';

interface PublicCustomField {
  field: number;
  field_name: string;
  field_type: string;
  value: string | null;
  options: any;
}

interface Organisation {
  id: number;
  name: string;
  street: string | null;
  city: string | null;
  postal_code: string | null;
  country: string | null;
  phone: string | null;
  logo_color: string | null;
}

interface PublicPractitioner {
  pk: number;
  first_name: string;
  last_name: string;
  email: string | null;
  mobile_phone_number: string | null;
  picture: string | null;
  job_title: string | null;
  specialities: { id: number; name: string }[];
  main_organisation: Organisation | null;
  location: string | null;
  street: string | null;
  city: string | null;
  postal_code: string | null;
  country: string | null;
  public_custom_fields: PublicCustomField[];
}

interface SlotEntry {
  date: string;
  start_time: string;
  end_time: string;
  duration: number;
  user_id: number;
}

interface SlotsState {
  loading: boolean;
  reasonId: number | null;
  specialityId: number | null;
  dates: string[];
  slotsByDate: Record<string, SlotEntry[]>;
  dateIndex: number;
  error: boolean;
}

@Component({
  selector: 'app-practitioner-profile',
  templateUrl: './practitioner-profile.page.html',
  styleUrls: ['./practitioner-profile.page.scss'],
  standalone: true,
  imports: [
    CommonModule,
    IonContent,
    IonSpinner,
    IonIcon,
    IonButton,
    AppHeaderComponent,
    AppFooterComponent,
    LocalDatePipe,
    TranslatePipe,
  ],
})
export class PractitionerProfilePage implements OnInit, OnDestroy {
  private destroy$ = new Subject<void>();

  practitioner = signal<PublicPractitioner | null>(null);
  isLoading = signal(true);
  notFound = signal(false);
  slotsState = signal<SlotsState | null>(null);

  constructor(
    private route: ActivatedRoute,
    private apiService: ApiService,
    private navCtrl: NavController,
    private router: Router,
    private doctorService: DoctorService,
  ) {}

  ngOnInit(): void {
    const pk = this.route.snapshot.paramMap.get('pk');
    if (!pk) {
      this.notFound.set(true);
      this.isLoading.set(false);
      return;
    }
    this.apiService.get<PublicPractitioner>(`/practitioners/${pk}/public/`).subscribe({
      next: (data) => {
        this.practitioner.set(data);
        this.isLoading.set(false);
        this.loadSlots(data);
      },
      error: () => {
        this.notFound.set(true);
        this.isLoading.set(false);
      },
    });
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  private loadSlots(p: PublicPractitioner): void {
    const specialityIds = p.specialities.map(s => s.id);
    if (specialityIds.length === 0) {
      this.slotsState.set({
        loading: false, reasonId: null, specialityId: null, dates: [], slotsByDate: {}, dateIndex: 0, error: false,
      });
      return;
    }

    this.slotsState.set({
      loading: true, reasonId: null, specialityId: null, dates: [], slotsByDate: {}, dateIndex: 0, error: false,
    });

    const reasonRequests = specialityIds.map(specId =>
      this.doctorService.getReasonsBySpeciality(specId).pipe(
        catchError(() => of([] as Reason[])),
      ),
    );

    forkJoin(reasonRequests)
      .pipe(takeUntil(this.destroy$))
      .subscribe(reasonLists => {
        const allReasons = new Map<number, Reason>();
        const reasonToSpeciality = new Map<number, number>();
        reasonLists.forEach((list, idx) => {
          const specId = specialityIds[idx];
          for (const reason of list) {
            allReasons.set(reason.id, reason);
            if (!reasonToSpeciality.has(reason.id)) {
              reasonToSpeciality.set(reason.id, specId);
            }
          }
        });

        if (allReasons.size === 0) {
          this.slotsState.set({
            loading: false, reasonId: null, specialityId: null, dates: [], slotsByDate: {}, dateIndex: 0, error: false,
          });
          return;
        }

        const shortestReason = Array.from(allReasons.values())
          .reduce((shortest, current) => current.duration < shortest.duration ? current : shortest);
        const specialityId = reasonToSpeciality.get(shortestReason.id) ?? specialityIds[0];

        this.doctorService.getAvailableSlots(shortestReason.id, { user_id: p.pk })
          .pipe(
            takeUntil(this.destroy$),
            catchError(() => of([] as SlotEntry[])),
          )
          .subscribe(slots => {
            const slotsByDate: Record<string, SlotEntry[]> = {};
            for (const slot of slots) {
              if (!slotsByDate[slot.date]) {
                slotsByDate[slot.date] = [];
              }
              slotsByDate[slot.date].push(slot);
            }
            const dates = Object.keys(slotsByDate).sort();

            this.slotsState.set({
              loading: false,
              reasonId: shortestReason.id,
              specialityId,
              dates,
              slotsByDate,
              dateIndex: 0,
              error: false,
            });
          });
      });
  }

  currentDateSlots(): SlotEntry[] {
    const state = this.slotsState();
    if (!state || state.dates.length === 0) return [];
    return state.slotsByDate[state.dates[state.dateIndex]] || [];
  }

  currentDateLabel(): string {
    const state = this.slotsState();
    if (!state || state.dates.length === 0) return '';
    return state.dates[state.dateIndex];
  }

  hasPrevDay(): boolean {
    const state = this.slotsState();
    return !!state && state.dateIndex > 0;
  }

  hasNextDay(): boolean {
    const state = this.slotsState();
    return !!state && state.dateIndex < state.dates.length - 1;
  }

  prevDay(): void {
    this.slotsState.update(state => {
      if (!state || state.dateIndex <= 0) return state;
      return { ...state, dateIndex: state.dateIndex - 1 };
    });
  }

  nextDay(): void {
    this.slotsState.update(state => {
      if (!state || state.dateIndex >= state.dates.length - 1) return state;
      return { ...state, dateIndex: state.dateIndex + 1 };
    });
  }

  goToBooking(): void {
    const p = this.practitioner();
    if (!p) return;
    const state = this.slotsState();
    const queryParams: any = { doctor_id: p.pk };
    if (state?.specialityId) {
      queryParams.speciality_id = state.specialityId;
    }
    this.router.navigate(['/new-request'], { queryParams });
  }

  goToBookingWithSlot(slot: SlotEntry): void {
    const p = this.practitioner();
    if (!p) return;
    const state = this.slotsState();
    this.router.navigate(['/new-request'], {
      queryParams: {
        doctor_id: p.pk,
        speciality_id: state?.specialityId ?? undefined,
        slot_date: slot.date,
        slot_time: slot.start_time,
        slot_duration: slot.duration,
      },
    });
  }

  formatAddress(p: PublicPractitioner): string {
    const parts = [p.street, p.postal_code, p.city, p.country].filter(Boolean);
    return parts.join(', ');
  }

  formatSpecialities(specialities: { id: number; name: string }[]): string {
    return specialities.map(s => s.name).join(', ');
  }

  hasPublicCustomFields(p: PublicPractitioner): boolean {
    return p.public_custom_fields.some(f => f.value);
  }

  goBack(): void {
    this.navCtrl.back();
  }
}