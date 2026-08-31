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
import { Subject, debounceTime, takeUntil } from 'rxjs';

import { PractitionerSearchService } from '../../../core/services/practitioner-search.service';
import { MapBounds, SearchItem } from '../../../core/models/search.model';

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
// Close enough to read the street when a single result is put in focus.
const FOCUS_ZOOM = 15;
// Browsing the map is a stream of small moves; only the settled view is worth
// a request.
const BROWSE_DEBOUNCE_MS = 400;
// How long a view the component set itself keeps raising zoom events. Covers
// Leaflet's 250ms zoom animation with room to spare.
const PROGRAMMATIC_MOVE_MS = 800;

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
  // Emitted when the user has browsed to another area, so the host can search
  // it. Never raised for a view this component set itself.
  @Output() boundsChanged = new EventEmitter<MapBounds>();

  @ViewChild('canvas', { static: true }) canvas!: ElementRef<HTMLDivElement>;

  private map?: L.Map;
  // Keyed by item id so a host can bring one result into focus.
  private markers = new Map<string, L.Marker>();
  private resizeObserver?: ResizeObserver;
  private destroy$ = new Subject<void>();
  private browsed$ = new Subject<void>();
  // Results are framed until the user takes over the view: past that point,
  // refreshing them must not pull the map from under them.
  private autoFrame = true;
  // Timestamp up to which a zoom is the component's own doing, not a gesture.
  private programmaticUntil = 0;
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
    this.watchBrowsing();
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['items'] && this.map) {
      this.render();
    }
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
    this.resizeObserver?.disconnect();
    this.map?.remove();
  }

  /**
   * Frame the next set of results again, for a host starting a new search:
   * those results describe another place, so the browsed view no longer holds.
   */
  resetFraming(): void {
    this.autoFrame = true;
  }

  // Dragging can only come from a gesture. Zooming cannot be told apart on its
  // own — fitBounds and setView raise it too — so it counts as browsing only
  // outside the window in which the component moved the view itself.
  private watchBrowsing(): void {
    if (!this.map) return;

    this.map.on('dragend', () => this.onBrowsed());
    this.map.on('zoomend', () => {
      if (Date.now() < this.programmaticUntil) return;
      this.onBrowsed();
    });

    this.browsed$
      .pipe(debounceTime(BROWSE_DEBOUNCE_MS), takeUntil(this.destroy$))
      .subscribe(() => this.emitBounds());
  }

  private onBrowsed(): void {
    this.autoFrame = false;
    this.browsed$.next();
  }

  private emitBounds(): void {
    if (!this.map) return;
    const bounds = this.map.getBounds();
    this.boundsChanged.emit({
      latMin: bounds.getSouth(),
      latMax: bounds.getNorth(),
      lngMin: bounds.getWest(),
      lngMax: bounds.getEast(),
    });
  }

  // Marks the zoom events the next view change is about to raise as the
  // component's own, so they are not mistaken for browsing.
  private markProgrammaticMove(): void {
    this.programmaticUntil = Date.now() + PROGRAMMATIC_MOVE_MS;
  }

  /**
   * Centre the map on one result and open its popup.
   *
   * Silently does nothing for an item without coordinates, which simply has no
   * marker on the map.
   */
  focusItem(item: SearchItem): void {
    const marker = this.markers.get(item.id);
    if (!this.map || !marker) return;

    // An explicit focus outranks the initial framing of the whole result set.
    this.pendingPoints = [];

    // Stacked layouts put the map above the list, so it can sit off-screen when
    // a result far down is picked. 'nearest' leaves it alone when it is visible.
    this.canvas.nativeElement.scrollIntoView({ behavior: 'smooth', block: 'nearest' });

    // Measure before centring: a stale size makes Leaflet centre on the wrong
    // half of the panel.
    this.map.invalidateSize();
    this.markProgrammaticMove();
    this.map.setView(marker.getLatLng(), Math.max(this.map.getZoom(), FOCUS_ZOOM), {
      animate: true,
    });
    marker.openPopup();
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
        // autoPan would shift the view to fit the popup in, which is precisely
        // what pushed a focused marker off centre. The marker is centred, so
        // its popup has the whole upper half of the panel to open into.
        .bindPopup(this.popupContent(item), { autoPan: false });

      marker.on('click', () => this.markerSelected.emit(item));
      this.markers.set(item.id, marker);
      points.push(L.latLng(coords.lat, coords.lng));
    }

    // Results that land while the user is browsing are theirs to look at where
    // they are: only an untouched view still gets framed.
    this.pendingPoints = this.autoFrame ? points : [];
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

    this.markProgrammaticMove();
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
    this.markers.clear();
  }
}
