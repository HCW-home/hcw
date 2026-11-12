import {
  AfterViewInit,
  Component,
  ElementRef,
  EventEmitter,
  Input,
  OnChanges,
  OnDestroy,
  Output,
  SimpleChanges,
  ViewChild,
} from '@angular/core';
import * as L from 'leaflet';

import { PractitionerSearchService } from '../../../core/services/practitioner-search.service';
import { SearchItem } from '../../../core/models/search.model';

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

// Centred on Switzerland until results give it something to frame.
const DEFAULT_VIEW: [number, number] = [46.8, 8.2];
const DEFAULT_ZOOM = 8;

/**
 * Leaflet view of a set of directory results. Hosts only hand it the items and
 * decide how big it is: the map watches its own box and re-measures itself, so
 * it can be dropped inside a panel that animates open without any timing hack.
 */
@Component({
  selector: 'app-search-map',
  templateUrl: './search-map.component.html',
  styleUrls: ['./search-map.component.scss'],
  standalone: true,
})
export class SearchMapComponent implements AfterViewInit, OnChanges, OnDestroy {
  @Input() items: SearchItem[] = [];
  @Output() markerSelected = new EventEmitter<SearchItem>();

  @ViewChild('canvas', { static: true }) canvas!: ElementRef<HTMLDivElement>;

  private map?: L.Map;
  private markers: L.Marker[] = [];
  private resizeObserver?: ResizeObserver;
  // Points waiting to be framed: the map can be laid out at zero size while the
  // results panel unfolds, and fitBounds needs a real box to pick a zoom.
  private pendingPoints: L.LatLng[] = [];

  constructor(private searchService: PractitionerSearchService) {}

  ngAfterViewInit(): void {
    this.map = L.map(this.canvas.nativeElement).setView(DEFAULT_VIEW, DEFAULT_ZOOM);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; OpenStreetMap contributors',
    }).addTo(this.map);

    this.render();
    this.observeResize();
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['items'] && this.map) {
      this.render();
    }
  }

  ngOnDestroy(): void {
    this.resizeObserver?.disconnect();
    this.map?.remove();
  }

  private observeResize(): void {
    if (typeof ResizeObserver === 'undefined') return;
    this.resizeObserver = new ResizeObserver(() => {
      this.map?.invalidateSize();
      this.fitToPoints();
    });
    this.resizeObserver.observe(this.canvas.nativeElement);
  }

  private render(): void {
    if (!this.map) return;

    this.clearMarkers();
    const points: L.LatLng[] = [];

    for (const item of this.items) {
      const coords = this.searchService.parseLocation(item.location);
      if (!coords) continue;

      const marker = L.marker([coords.lat, coords.lng], {
        icon: item.type === 'organisation' ? orgIcon : doctorIcon,
      })
        .addTo(this.map)
        .bindPopup(this.popupContent(item));

      marker.on('click', () => this.markerSelected.emit(item));
      this.markers.push(marker);
      points.push(L.latLng(coords.lat, coords.lng));
    }

    this.pendingPoints = points;
    this.fitToPoints();
  }

  private fitToPoints(): void {
    if (!this.map || this.pendingPoints.length === 0) return;

    this.map.invalidateSize();
    const size = this.map.getSize();
    if (size.x === 0 || size.y === 0) {
      // Still folded: the resize observer will call back once it has a box.
      return;
    }

    this.map.fitBounds(L.latLngBounds(this.pendingPoints), { padding: [50, 50], maxZoom: 14 });
    // Framed once; later resizes must not undo a manual pan or zoom.
    this.pendingPoints = [];
  }

  private popupContent(item: SearchItem): string {
    let content = `<strong>${item.name}</strong>`;
    if (item.specialities) {
      content += `<br><em>${item.specialities}</em>`;
    }
    if (item.subtitle) {
      content += `<br>${item.subtitle}`;
    }
    return content;
  }

  private clearMarkers(): void {
    this.markers.forEach(marker => marker.remove());
    this.markers = [];
  }
}
