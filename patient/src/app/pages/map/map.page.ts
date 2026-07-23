import { Component, OnInit, OnDestroy, signal, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import {
  IonContent,
  IonIcon,
  IonSpinner,
} from '@ionic/angular/standalone';
import { TranslatePipe } from '@ngx-translate/core';
import { Subject, takeUntil, forkJoin, of } from 'rxjs';
import { catchError, map as rxMap } from 'rxjs/operators';
import * as L from 'leaflet';

import { ApiService } from '../../core/services/api.service';
import { AuthService } from '../../core/services/auth.service';
import { TranslationService } from '../../core/services/translation.service';
import { AppHeaderComponent } from '../../shared/app-header/app-header.component';
import { AppFooterComponent } from '../../shared/app-footer/app-footer.component';
import { LocalDatePipe } from '../../shared/pipes/local-date.pipe';
import { DoctorService, Reason } from '../../core/services/doctor.service';

interface Organisation {
  id: number;
  name: string;
  location: string | null;
  street: string | null;
  city: string | null;
  postal_code: string | null;
  country: string | null;
  phone: string | null;
  logo_color: string | null;
}

interface Doctor {
  pk: number;
  first_name: string;
  last_name: string;
  email?: string;
  job_title?: string;
  picture?: string;
  location?: string | null;
  specialities?: { id: number; name: string }[];
  main_organisation?: Organisation;
}

interface MapItem {
  type: 'organisation' | 'doctor';
  id: string;
  name: string;
  subtitle: string;
  specialities: string;
  location: string | null;
  logo: string | null;
  initials: string;
  org?: Organisation;
  doctor?: Doctor;
}

interface SlotEntry {
  date: string;
  start_time: string;
  end_time: string;
  duration: number;
  user_id: number;
}

interface DoctorSlotsState {
  loading: boolean;
  reasonId: number | null;
  dates: string[];
  slotsByDate: Record<string, SlotEntry[]>;
  dateIndex: number;
  error: boolean;
}

const orgIcon = L.divIcon({
  className: 'map-marker-org',
  html: '<div class="marker-pin marker-org"><ion-icon name="business"></ion-icon></div>',
  iconSize: [32, 42],
  iconAnchor: [16, 42],
  popupAnchor: [0, -36],
});

const doctorIcon = L.divIcon({
  className: 'map-marker-doctor',
  html: '<div class="marker-pin marker-doctor"><ion-icon name="person"></ion-icon></div>',
  iconSize: [32, 42],
  iconAnchor: [16, 42],
  popupAnchor: [0, -36],
});

@Component({
  selector: 'app-map',
  templateUrl: './map.page.html',
  styleUrls: ['./map.page.scss'],
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    IonContent,
    IonIcon,
    IonSpinner,
    AppHeaderComponent,
    AppFooterComponent,
    LocalDatePipe,
    TranslatePipe,
  ]
})
export class MapPage implements OnInit, OnDestroy {
  private destroy$ = new Subject<void>();
  private t = inject(TranslationService);
  private map!: L.Map;
  private mapInitialized = false;
  private markers: L.Marker[] = [];
  private reasonsCache = new Map<number, Reason[]>();

  items = signal<MapItem[]>([]);
  isLoading = signal(false);
  isPublicEnabled = signal<boolean | null>(null);
  hasSearched = signal(false);
  searchQuery = signal('');
  locationQuery = signal('');
  onlineBookingOnly = signal(false);
  selectedItemId = signal<string | null>(null);
  slotsState = signal<Record<string, DoctorSlotsState>>({});

  constructor(
    private apiService: ApiService,
    private authService: AuthService,
    private router: Router,
    private doctorService: DoctorService,
  ) {}

  ngOnInit(): void {
    this.checkPublicOrganisations();
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
    if (this.map) {
      this.map.remove();
    }
  }

  private checkPublicOrganisations(): void {
    this.authService.getConfig()
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (config: any) => {
          this.isPublicEnabled.set(!!config?.public_organisations);
        },
        error: () => {
          this.isPublicEnabled.set(false);
        }
      });
  }

  private initMapIfNeeded(): void {
    if (this.mapInitialized) return;
    const mapEl = document.getElementById('map-container');
    if (!mapEl) return;

    this.map = L.map('map-container').setView([46.8, 8.2], 8);

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; OpenStreetMap contributors'
    }).addTo(this.map);

    this.mapInitialized = true;
  }

  private combinedSearchTerm(): string {
    const who = this.searchQuery().trim();
    const location = this.locationQuery().trim();
    return who || location;
  }

  onSearchInput(event: Event): void {
    this.searchQuery.set((event.target as HTMLInputElement).value);
  }

  onLocationInput(event: Event): void {
    this.locationQuery.set((event.target as HTMLInputElement).value);
  }

  onOnlineBookingToggle(): void {
    this.onlineBookingOnly.set(!this.onlineBookingOnly());
    if (this.hasSearched()) {
      this.runSearch();
    }
  }

  submitSearch(): void {
    const term = this.combinedSearchTerm();
    if (!term) return;
    this.hasSearched.set(true);
    setTimeout(() => this.initMapIfNeeded(), 0);
    this.runSearch();
  }

  private runSearch(): void {
    const term = this.combinedSearchTerm();
    if (!term) {
      this.items.set([]);
      this.clearMarkers();
      return;
    }

    const params: any = { search: term, limit: 50 };
    if (this.onlineBookingOnly()) {
      params.has_slots = true;
    }
    this.fetchData(params);
  }

  private fetchData(params: any): void {
    this.isLoading.set(true);

    this.apiService
      .get<{ organisations: Organisation[]; practitioners: Doctor[] }>('/map/', params)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: ({ organisations, practitioners }) => {
          const orgs: Organisation[] = organisations || [];
          const docs: Doctor[] = practitioners || [];

          const items: MapItem[] = [];

          for (const org of orgs) {
            items.push({
              type: 'organisation',
              id: `org-${org.id}`,
              name: org.name,
              subtitle: this.formatAddress(org),
              specialities: '',
              location: org.location,
              logo: org.logo_color,
              initials: org.name.charAt(0).toUpperCase(),
              org,
            });
          }

          for (const doc of docs) {
            const docLocation = doc.location || doc.main_organisation?.location || null;
            const specialities = doc.specialities?.map(s => s.name).join(', ') || '';
            const org = doc.main_organisation;
            const subtitle = org
              ? [org.name, this.formatAddress(org)].filter(Boolean).join(' - ')
              : '';

            items.push({
              type: 'doctor',
              id: `doc-${doc.pk}`,
              name: `${doc.first_name} ${doc.last_name}`,
              subtitle,
              specialities,
              location: docLocation,
              logo: doc.picture || null,
              initials: `${doc.first_name.charAt(0)}${doc.last_name.charAt(0)}`.toUpperCase(),
              doctor: doc,
            });
          }

          this.items.set(items);
          this.isLoading.set(false);
          this.updateMarkers();
          this.fitMapToItems(items);
          this.loadSlotsForDoctors(items);
        },
        error: () => {
          this.isLoading.set(false);
        }
      });
  }

  private loadSlotsForDoctors(items: MapItem[]): void {
    const doctorItems = items.filter(i => i.type === 'doctor' && i.doctor);
    const state = { ...this.slotsState() };

    for (const item of doctorItems) {
      state[item.id] = {
        loading: true,
        reasonId: null,
        dates: [],
        slotsByDate: {},
        dateIndex: 0,
        error: false,
      };
    }
    this.slotsState.set(state);

    for (const item of doctorItems) {
      this.loadSlotsForDoctor(item);
    }
  }

  private loadSlotsForDoctor(item: MapItem): void {
    const doctor = item.doctor!;
    const specialityIds = doctor.specialities?.map(s => s.id) || [];

    if (specialityIds.length === 0) {
      this.setSlotsState(item.id, { loading: false, reasonId: null, dates: [], slotsByDate: {}, dateIndex: 0, error: false });
      return;
    }

    const reasonRequests = specialityIds.map(specId => {
      const cached = this.reasonsCache.get(specId);
      if (cached) {
        return of(cached);
      }
      return this.doctorService.getReasonsBySpeciality(specId).pipe(
        rxMap(reasons => {
          this.reasonsCache.set(specId, reasons);
          return reasons;
        }),
        catchError(() => of([] as Reason[]))
      );
    });

    forkJoin(reasonRequests)
      .pipe(takeUntil(this.destroy$))
      .subscribe(reasonLists => {
        const allReasons = new Map<number, Reason>();
        for (const list of reasonLists) {
          for (const reason of list) {
            allReasons.set(reason.id, reason);
          }
        }

        if (allReasons.size === 0) {
          this.setSlotsState(item.id, { loading: false, reasonId: null, dates: [], slotsByDate: {}, dateIndex: 0, error: false });
          return;
        }

        const shortestReason = Array.from(allReasons.values())
          .reduce((shortest, current) => current.duration < shortest.duration ? current : shortest);

        this.doctorService.getAvailableSlots(shortestReason.id, { user_id: doctor.pk })
          .pipe(
            takeUntil(this.destroy$),
            catchError(() => of([] as SlotEntry[]))
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

            this.setSlotsState(item.id, {
              loading: false,
              reasonId: shortestReason.id,
              dates,
              slotsByDate,
              dateIndex: 0,
              error: false,
            });
          });
      });
  }

  private setSlotsState(itemId: string, state: DoctorSlotsState): void {
    this.slotsState.update(current => ({ ...current, [itemId]: state }));
  }

  getSlotsState(itemId: string): DoctorSlotsState | undefined {
    return this.slotsState()[itemId];
  }

  currentDateSlots(itemId: string): SlotEntry[] {
    const state = this.slotsState()[itemId];
    if (!state || state.dates.length === 0) return [];
    return state.slotsByDate[state.dates[state.dateIndex]] || [];
  }

  currentDateLabel(itemId: string): string {
    const state = this.slotsState()[itemId];
    if (!state || state.dates.length === 0) return '';
    return state.dates[state.dateIndex];
  }

  hasPrevDay(itemId: string): boolean {
    const state = this.slotsState()[itemId];
    return !!state && state.dateIndex > 0;
  }

  hasNextDay(itemId: string): boolean {
    const state = this.slotsState()[itemId];
    return !!state && state.dateIndex < state.dates.length - 1;
  }

  prevDay(itemId: string): void {
    this.slotsState.update(current => {
      const state = current[itemId];
      if (!state || state.dateIndex <= 0) return current;
      return { ...current, [itemId]: { ...state, dateIndex: state.dateIndex - 1 } };
    });
  }

  nextDay(itemId: string): void {
    this.slotsState.update(current => {
      const state = current[itemId];
      if (!state || state.dateIndex >= state.dates.length - 1) return current;
      return { ...current, [itemId]: { ...state, dateIndex: state.dateIndex + 1 } };
    });
  }

  goToBooking(item: MapItem): void {
    const state = this.slotsState()[item.id];
    const queryParams: any = { doctor_id: item.doctor!.pk };
    if (state?.reasonId) {
      queryParams.reason_id = state.reasonId;
    }
    this.router.navigate(['/new-request'], { queryParams });
  }

  goToBookingWithSlot(item: MapItem, slot: SlotEntry): void {
    const state = this.slotsState()[item.id];
    this.router.navigate(['/new-request'], {
      queryParams: {
        doctor_id: item.doctor!.pk,
        reason_id: state?.reasonId ?? undefined,
        slot_date: slot.date,
        slot_time: slot.start_time,
      }
    });
  }

  private clearMarkers(): void {
    this.markers.forEach(m => m.remove());
    this.markers = [];
  }

  private updateMarkers(): void {
    if (!this.map) return;

    this.clearMarkers();

    for (const item of this.items()) {
      const coords = this.parseLocation(item.location);
      if (!coords) continue;

      const icon = item.type === 'organisation' ? orgIcon : doctorIcon;

      let popupContent = `<strong>${item.name}</strong>`;
      if (item.specialities) {
        popupContent += `<br><em>${item.specialities}</em>`;
      }
      if (item.subtitle) {
        popupContent += `<br>${item.subtitle}`;
      }

      const marker = L.marker([coords.lat, coords.lng], { icon })
        .addTo(this.map)
        .bindPopup(popupContent);

      marker.on('click', () => {
        this.selectedItemId.set(item.id);
      });

      this.markers.push(marker);
    }
  }

  private fitMapToItems(items: MapItem[]): void {
    if (!this.map) return;
    const points: L.LatLng[] = [];
    for (const item of items) {
      const coords = this.parseLocation(item.location);
      if (coords) {
        points.push(L.latLng(coords.lat, coords.lng));
      }
    }
    if (points.length > 0) {
      this.map.fitBounds(L.latLngBounds(points), { padding: [50, 50], maxZoom: 14 });
    }
  }

  private parseLocation(location: string | null): { lat: number; lng: number } | null {
    if (!location) return null;
    const parts = location.split(',');
    if (parts.length !== 2) return null;
    const lat = parseFloat(parts[0].trim());
    const lng = parseFloat(parts[1].trim());
    if (isNaN(lat) || isNaN(lng)) return null;
    return { lat, lng };
  }

  formatAddress(org: Organisation): string {
    const parts = [org.street, org.postal_code, org.city, org.country].filter(Boolean);
    return parts.join(', ');
  }

  selectItem(item: MapItem): void {
    this.selectedItemId.set(item.id);
    const coords = this.parseLocation(item.location);
    if (coords && this.map) {
      this.map.setView([coords.lat, coords.lng], 15);
    }
  }

  goToProfile(item: MapItem): void {
    if (item.type === 'doctor' && item.doctor) {
      this.router.navigate(['/practitioners', item.doctor.pk, 'public']);
    }
  }

  isSelected(item: MapItem): boolean {
    return this.selectedItemId() === item.id;
  }
}