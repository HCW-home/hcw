import { Component, OnInit, OnDestroy, signal, computed, viewChild } from '@angular/core';
import { Location } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import {
  IonContent,
  IonIcon,
  IonSpinner,
} from '@ionic/angular/standalone';
import { TranslatePipe } from '@ngx-translate/core';
import { Subject, takeUntil } from 'rxjs';

import { AuthService } from '../../core/services/auth.service';
import { PractitionerSearchService } from '../../core/services/practitioner-search.service';
import { AppFooterComponent } from '../../shared/app-footer/app-footer.component';
import { SearchBarComponent } from '../../shared/components/search-bar/search-bar.component';
import { SearchMapComponent } from '../../shared/components/search-map/search-map.component';
import { SearchResultCardComponent } from '../../shared/components/search-result-card/search-result-card.component';
import { PractitionerDetailsComponent } from '../../shared/components/practitioner-details/practitioner-details.component';
import { BookingIntent, SearchItem, SearchQuery } from '../../core/models/search.model';

@Component({
  selector: 'app-map',
  templateUrl: './map.page.html',
  styleUrls: ['./map.page.scss'],
  standalone: true,
  imports: [
    IonContent,
    IonIcon,
    IonSpinner,
    AppFooterComponent,
    SearchBarComponent,
    SearchMapComponent,
    SearchResultCardComponent,
    PractitionerDetailsComponent,
    TranslatePipe,
  ]
})
export class MapPage implements OnInit, OnDestroy {
  private destroy$ = new Subject<void>();
  // Kept so the online-booking toggle can re-run the very same search.
  private lastQuery: SearchQuery | null = null;

  items = signal<SearchItem[]>([]);
  isLoading = signal(false);
  isPublicEnabled = signal<boolean | null>(null);
  hasSearched = signal(false);

  onlineBookingOnly = signal(false);
  selectedItemId = signal<string | null>(null);
  // Practitioner whose full sheet replaces the result list, if any.
  detailPk = signal<number | null>(null);

  searchMap = viewChild(SearchMapComponent);

  isAuthenticated = signal(false);
  canViewMap = computed(() => this.isPublicEnabled() || this.isAuthenticated());

  constructor(
    private authService: AuthService,
    private router: Router,
    private route: ActivatedRoute,
    private location: Location,
    private searchService: PractitionerSearchService,
  ) {}

  ngOnInit(): void {
    this.checkPublicOrganisations();

    // /practitioners/:pk/public renders this very page with that practitioner
    // opened, so a shared link lands on the same screen the button produces.
    const pk = Number(this.route.snapshot.paramMap.get('pk'));
    if (pk) {
      this.openDetailsForPk(pk);
    }
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  private checkPublicOrganisations(): void {
    this.authService.authReady.then(() => {
      this.isAuthenticated.set(this.authService.isAuthenticatedValue);
    });

    this.authService.isAuthenticated$
      .pipe(takeUntil(this.destroy$))
      .subscribe(value => this.isAuthenticated.set(value));

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

  onSearch(query: SearchQuery): void {
    this.lastQuery = query;
    this.hasSearched.set(true);
    this.runSearch();
  }

  setOnlineBookingOnly(value: boolean): void {
    if (this.onlineBookingOnly() === value) return;
    this.onlineBookingOnly.set(value);
    if (this.hasSearched()) {
      this.runSearch();
    }
  }

  private runSearch(): void {
    const query = this.lastQuery;
    if (!query) {
      this.items.set([]);
      return;
    }

    // A new result set makes the sheet of the previous one irrelevant.
    this.closeDetails();

    this.isLoading.set(true);
    this.searchService
      .search({ ...query, hasSlots: this.onlineBookingOnly() })
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: items => {
          this.items.set(items);
          this.isLoading.set(false);
        },
        error: () => {
          this.isLoading.set(false);
        }
      });
  }

  goToBooking(intent: BookingIntent): void {
    const doctor = intent.item.doctor;
    if (!doctor) return;

    const queryParams: any = { doctor_id: doctor.pk };
    const specialityId = intent.specialityId ?? doctor.specialities?.[0]?.id ?? null;
    if (specialityId) {
      queryParams.speciality_id = specialityId;
    }
    if (intent.slot) {
      queryParams.slot_date = intent.slot.date;
      queryParams.slot_time = intent.slot.start_time;
      queryParams.slot_duration = intent.slot.duration;
    }
    this.router.navigate(['/new-request'], { queryParams });
  }

  // Grows the result card into the practitioner's full sheet, in place. The URL
  // follows so the sheet stays shareable, without rebuilding the page.
  openDetails(item: SearchItem): void {
    if (item.type !== 'doctor' || !item.doctor) return;

    // Reached from the search bar: the result may not be in the list yet.
    if (!this.items().some(existing => existing.id === item.id)) {
      this.items.set([item]);
    }

    this.hasSearched.set(true);
    this.onItemSelected(item);
    this.detailPk.set(item.doctor.pk);
    this.location.go(`/practitioners/${item.doctor.pk}/public`);
  }

  closeDetails(): void {
    if (this.detailPk() !== null) {
      this.location.replaceState('/map');
    }
    this.detailPk.set(null);
  }

  // Deep link: fetch the practitioner and show them as the only result.
  private openDetailsForPk(pk: number): void {
    this.hasSearched.set(true);
    this.isLoading.set(true);

    this.searchService
      .getDoctorItem(pk)
      .pipe(takeUntil(this.destroy$))
      .subscribe(item => {
        this.isLoading.set(false);
        if (!item) return;
        this.items.set([item]);
        this.selectedItemId.set(item.id);
        this.detailPk.set(pk);
      });
  }

  isDetail(item: SearchItem): boolean {
    return !!item.doctor && this.detailPk() === item.doctor.pk;
  }

  isSelected(item: SearchItem): boolean {
    return this.selectedItemId() === item.id;
  }

  // Picking a result from the list only highlights it and brings it into view;
  // the practitioner sheet is reached through the card's details button.
  onItemSelected(item: SearchItem): void {
    this.selectedItemId.set(item.id);
    this.searchMap()?.focusItem(item);
  }

  onMarkerSelected(item: SearchItem): void {
    this.selectedItemId.set(item.id);
  }
}
