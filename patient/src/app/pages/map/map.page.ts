import { Component, OnInit, OnDestroy, signal, computed, viewChild } from '@angular/core';
import { Router } from '@angular/router';
import {
  IonContent,
  IonIcon,
  IonSpinner,
} from '@ionic/angular/standalone';
import { TranslatePipe } from '@ngx-translate/core';
import { Subject, takeUntil } from 'rxjs';

import { AuthService } from '../../core/services/auth.service';
import { PractitionerSearchService } from '../../core/services/practitioner-search.service';
import { AppHeaderComponent } from '../../shared/app-header/app-header.component';
import { AppFooterComponent } from '../../shared/app-footer/app-footer.component';
import { SearchBarComponent } from '../../shared/components/search-bar/search-bar.component';
import { SearchMapComponent } from '../../shared/components/search-map/search-map.component';
import { SearchResultCardComponent } from '../../shared/components/search-result-card/search-result-card.component';
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
    AppHeaderComponent,
    AppFooterComponent,
    SearchBarComponent,
    SearchMapComponent,
    SearchResultCardComponent,
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

  searchMap = viewChild(SearchMapComponent);

  isAuthenticated = signal(false);
  canViewMap = computed(() => this.isPublicEnabled() || this.isAuthenticated());

  constructor(
    private authService: AuthService,
    private router: Router,
    private searchService: PractitionerSearchService,
  ) {}

  ngOnInit(): void {
    this.checkPublicOrganisations();
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

  goToProfile(item: SearchItem): void {
    if (item.type === 'doctor' && item.doctor) {
      this.router.navigate(['/practitioners', item.doctor.pk, 'public']);
    }
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
