import { Component, EventEmitter, Input, OnChanges, OnDestroy, Output, SimpleChanges, computed, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IonIcon, IonSpinner } from '@ionic/angular/standalone';
import { TranslatePipe } from '@ngx-translate/core';
import { Subject, takeUntil } from 'rxjs';

import { LocalDatePipe } from '../../pipes/local-date.pipe';
import { PractitionerSearchService } from '../../../core/services/practitioner-search.service';
import { BookingIntent, DoctorSlots, SearchItem } from '../../../core/models/search.model';
import { Slot } from '../../../core/models/consultation.model';

/**
 * One directory result — practitioner or organisation — with the practitioner's
 * next available slots. The card owns its availability so a list of results
 * loads day by day on its own, and hands the booking back to its host.
 */
@Component({
  selector: 'app-search-result-card',
  templateUrl: './search-result-card.component.html',
  styleUrls: ['./search-result-card.component.scss'],
  standalone: true,
  imports: [
    CommonModule,
    IonIcon,
    IonSpinner,
    LocalDatePipe,
    TranslatePipe,
  ]
})
export class SearchResultCardComponent implements OnChanges, OnDestroy {
  @Input({ required: true }) item!: SearchItem;
  @Input() selected = false;

  @Output() itemClick = new EventEmitter<SearchItem>();
  @Output() book = new EventEmitter<BookingIntent>();

  private destroy$ = new Subject<void>();

  isLoadingSlots = signal(false);
  slots = signal<DoctorSlots | null>(null);
  dateIndex = signal(0);

  hasSlots = computed(() => (this.slots()?.dates.length ?? 0) > 0);

  currentDate = computed(() => {
    const slots = this.slots();
    if (!slots || slots.dates.length === 0) return '';
    return slots.dates[this.dateIndex()] ?? '';
  });

  currentSlots = computed(() => {
    const slots = this.slots();
    if (!slots) return [] as Slot[];
    return slots.slotsByDate[this.currentDate()] ?? [];
  });

  hasPrevDay = computed(() => this.dateIndex() > 0);
  hasNextDay = computed(() => this.dateIndex() < (this.slots()?.dates.length ?? 0) - 1);

  constructor(private searchService: PractitionerSearchService) {}

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['item']) {
      this.loadSlots();
    }
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  prevDay(event: Event): void {
    event.stopPropagation();
    this.dateIndex.update(index => Math.max(0, index - 1));
  }

  nextDay(event: Event): void {
    event.stopPropagation();
    const last = (this.slots()?.dates.length ?? 0) - 1;
    this.dateIndex.update(index => Math.min(last, index + 1));
  }

  onCardClick(): void {
    this.itemClick.emit(this.item);
  }

  onBook(event: Event, slot: Slot | null = null): void {
    event.stopPropagation();
    this.book.emit({
      item: this.item,
      specialityId: this.slots()?.specialityId ?? null,
      slot,
    });
  }

  private loadSlots(): void {
    this.slots.set(null);
    this.dateIndex.set(0);

    if (this.item?.type !== 'doctor') {
      return;
    }

    this.isLoadingSlots.set(true);
    this.searchService.loadSlots(this.item)
      .pipe(takeUntil(this.destroy$))
      .subscribe(slots => {
        this.slots.set(slots);
        this.isLoadingSlots.set(false);
      });
  }
}
