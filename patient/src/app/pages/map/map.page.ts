import { Component, OnInit, OnDestroy, signal, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import {
  IonContent,
  IonIcon,
  IonSpinner,
} from '@ionic/angular/standalone';
import { TranslatePipe } from '@ngx-translate/core';
import { Subject, takeUntil, debounceTime, distinctUntilChanged, forkJoin } from 'rxjs';
import * as L from 'leaflet';

import { ApiService, PaginatedResponse } from '../../core/services/api.service';
import { AuthService } from '../../core/services/auth.service';
import { TranslationService } from '../../core/services/translation.service';
import { AppHeaderComponent } from '../../shared/app-header/app-header.component';

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

interface Speciality {
  id: number;
  name: string;
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
    TranslatePipe,
  ]
})
export class MapPage implements OnInit, OnDestroy {
  private destroy$ = new Subject<void>();
  private t = inject(TranslationService);
  private map!: L.Map;
  private markers: L.Marker[] = [];
  private searchSubject = new Subject<string>();
  private boundsSubject = new Subject<L.LatLngBounds>();
  private isSearchMode = false;

  items = signal<MapItem[]>([]);
  specialities = signal<Speciality[]>([]);
  isLoading = signal(false);
  isPublicEnabled = signal<boolean | null>(null);
  searchQuery = signal('');
  selectedSpeciality = signal<number | null>(null);
  selectedItemId = signal<string | null>(null);
  onlineBookingOnly = signal(false);

  constructor(
    private apiService: ApiService,
    private authService: AuthService,
  ) {}

  ngOnInit(): void {
    this.checkPublicOrganisations();

    this.searchSubject.pipe(
      debounceTime(400),
      distinctUntilChanged(),
      takeUntil(this.destroy$)
    ).subscribe(query => {
      if (query.trim()) {
        this.isSearchMode = true;
        this.searchFromApi(query.trim());
      } else {
        this.isSearchMode = false;
        this.loadFromBounds();
      }
    });

    this.boundsSubject.pipe(
      debounceTime(300),
      takeUntil(this.destroy$)
    ).subscribe(bounds => {
      if (!this.isSearchMode) {
        this.loadFromBoundsWithCoords(bounds);
      }
    });
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
          if (config?.public_organisations) {
            this.loadSpecialities();
            setTimeout(() => this.initMap(), 100);
          }
        },
        error: () => {
          this.isPublicEnabled.set(false);
        }
      });
  }

  private loadSpecialities(): void {
    this.apiService.get<Speciality[]>('/specialities/')
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (data) => {
          const results = Array.isArray(data) ? data : (data as any).results || [];
          this.specialities.set(results);
        }
      });
  }

  private initMap(): void {
    const mapEl = document.getElementById('map-container');
    if (!mapEl) return;

    this.map = L.map('map-container').setView([46.8, 8.2], 8);

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; OpenStreetMap contributors'
    }).addTo(this.map);

    this.map.on('moveend', () => {
      this.boundsSubject.next(this.map.getBounds());
    });

    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          if (this.map) {
            this.map.setView([position.coords.latitude, position.coords.longitude], 12);
          }
        },
        () => {
          this.boundsSubject.next(this.map.getBounds());
        }
      );
    } else {
      this.boundsSubject.next(this.map.getBounds());
    }
  }

  onSpecialityChange(event: Event): void {
    const value = (event.target as HTMLSelectElement).value;
    this.selectedSpeciality.set(value ? Number(value) : null);
    this.reload();
  }

  private reload(): void {
    if (this.isSearchMode) {
      this.searchFromApi(this.searchQuery().trim());
    } else {
      this.loadFromBounds();
    }
  }

  private loadFromBounds(): void {
    if (!this.map) return;
    this.boundsSubject.next(this.map.getBounds());
  }

  onOnlineBookingChange(event: Event): void {
    this.onlineBookingOnly.set((event.target as HTMLInputElement).checked);
    this.reload();
  }

  private loadFromBoundsWithCoords(bounds: L.LatLngBounds): void {
    const params: any = {
      lat_min: bounds.getSouth().toFixed(6),
      lat_max: bounds.getNorth().toFixed(6),
      lng_min: bounds.getWest().toFixed(6),
      lng_max: bounds.getEast().toFixed(6),
      limit: 50,
    };
    if (this.selectedSpeciality()) {
      params.speciality = this.selectedSpeciality();
    }
    if (this.onlineBookingOnly()) {
      params.has_slots = true;
    }
    this.fetchData(params);
  }

  private searchFromApi(query: string): void {
    const params: any = { search: query, limit: 50 };
    if (this.selectedSpeciality()) {
      params.speciality = this.selectedSpeciality();
    }
    if (this.onlineBookingOnly()) {
      params.has_slots = true;
    }
    this.fetchData(params);
  }

  private fetchData(params: any): void {
    this.isLoading.set(true);

    forkJoin({
      organisations: this.apiService.get<PaginatedResponse<Organisation>>('/organisations/', params),
      doctors: this.apiService.get<PaginatedResponse<Doctor>>('/users/', params),
    })
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: ({ organisations, doctors }) => {
          const orgs: Organisation[] = Array.isArray(organisations)
            ? organisations
            : organisations.results || [];
          const docs: Doctor[] = doctors.results || [];

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

          if (this.isSearchMode) {
            this.fitMapToItems(items);
          }
        },
        error: () => {
          this.isLoading.set(false);
        }
      });
  }

  private updateMarkers(): void {
    if (!this.map) return;

    this.markers.forEach(m => m.remove());
    this.markers = [];

    for (const item of this.items()) {
      const coords = this.parseLocation(item.location);
      if (!coords) continue;

      const icon = item.type === 'organisation' ? orgIcon : doctorIcon;

      let popupContent = `<strong>${item.name}</strong>`;
      if (item.doctor?.job_title) {
        popupContent += `<br>${item.doctor.job_title}`;
      }
      if (item.specialities) {
        popupContent += `<br><em>${item.specialities}</em>`;
      }
      if (item.subtitle) {
        popupContent += `<br><ion-icon name="location-outline" style="font-size:12px"></ion-icon> ${item.subtitle}`;
      }
      const phone = item.org?.phone || item.doctor?.main_organisation?.phone;
      if (phone) {
        popupContent += `<br><ion-icon name="call-outline" style="font-size:12px"></ion-icon> <a href="tel:${phone}">${phone}</a>`;
      }
      if (item.doctor?.email) {
        popupContent += `<br><ion-icon name="mail-outline" style="font-size:12px"></ion-icon> <a href="mailto:${item.doctor.email}">${item.doctor.email}</a>`;
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

  onSearchInput(event: Event): void {
    const value = (event.target as HTMLInputElement).value;
    this.searchQuery.set(value);
    this.searchSubject.next(value);
  }

  selectItem(item: MapItem): void {
    this.selectedItemId.set(item.id);
    const coords = this.parseLocation(item.location);
    if (coords && this.map) {
      this.map.setView([coords.lat, coords.lng], 15);
      const idx = this.items().indexOf(item);
      if (idx >= 0 && this.markers[idx]) {
        this.markers[idx].openPopup();
      }
    }
  }

  isSelected(item: MapItem): boolean {
    return this.selectedItemId() === item.id;
  }
}
