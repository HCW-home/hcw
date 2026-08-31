import { Component, ElementRef, EventEmitter, Input, OnDestroy, OnInit, Output, computed, signal, viewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IonIcon, IonSpinner } from '@ionic/angular/standalone';
import { TranslatePipe } from '@ngx-translate/core';
import { Subject, of } from 'rxjs';
import { catchError, debounceTime, distinctUntilChanged, switchMap, takeUntil } from 'rxjs/operators';

import { PractitionerSearchService } from '../../../core/services/practitioner-search.service';
import { SpecialityService } from '../../../core/services/speciality.service';
import { Speciality } from '../../../core/models/doctor.model';
import { SearchItem, SearchQuery } from '../../../core/models/search.model';

// Free-text suggestions only kick in once the term is worth a round trip.
const SUGGEST_MIN_LENGTH = 2;
const SUGGEST_LIMIT = 6;
// Before anything is typed the panel just lists the available specialities.
const SUGGEST_IDLE_LIMIT = 8;

// One chunk of a suggestion label, flagged when it matches the typed term so
// the template can highlight it without going through innerHTML.
interface HighlightPart {
  text: string;
  match: boolean;
}

/**
 * One-line "who / where" search bar with its suggestion panel, shared by the
 * practitioner map and the booking wizard so both stay strictly identical.
 * The host owns the results: the bar only emits what was asked for.
 */
@Component({
  selector: 'app-search-bar',
  templateUrl: './search-bar.component.html',
  styleUrls: ['./search-bar.component.scss'],
  standalone: true,
  imports: [
    CommonModule,
    IonIcon,
    IonSpinner,
    TranslatePipe,
  ]
})
export class SearchBarComponent implements OnInit, OnDestroy {
  // Prefill, for a search started on another page and continued here.
  @Input() set who(value: string | null | undefined) {
    this.whoQuery.set(value ?? '');
  }

  @Input() set where(value: string | null | undefined) {
    this.whereQuery.set(value ?? '');
  }

  @Output() search = new EventEmitter<SearchQuery>();
  // A practitioner suggestion is a direct hit: the host decides whether that
  // opens their profile or starts a booking.
  @Output() practitionerSelected = new EventEmitter<SearchItem>();

  private destroy$ = new Subject<void>();
  private suggestInput$ = new Subject<string>();
  private specialitiesLoaded = false;

  // Kept so clearing a field can hand the caret straight back to it.
  private whoInput = viewChild<ElementRef<HTMLInputElement>>('whoInput');
  private whereInput = viewChild<ElementRef<HTMLInputElement>>('whereInput');

  whoQuery = signal('');
  whereQuery = signal('');

  suggestOpen = signal(false);
  isSuggestLoading = signal(false);
  suggestPractitioners = signal<SearchItem[]>([]);
  suggestOrganisations = signal<SearchItem[]>([]);
  private allSpecialities = signal<Speciality[]>([]);

  // Typing splits the panel into three columns; before that it is a plain
  // speciality picker.
  isSuggestSearching = computed(() => this.whoQuery().trim().length >= SUGGEST_MIN_LENGTH);

  suggestSpecialities = computed(() => {
    const term = this.whoQuery().trim().toLowerCase();
    const all = this.allSpecialities();
    if (!term) {
      return all.slice(0, SUGGEST_IDLE_LIMIT);
    }
    return all
      .filter(speciality => speciality.name.toLowerCase().includes(term))
      .slice(0, SUGGEST_LIMIT);
  });

  hasSuggestions = computed(
    () =>
      this.suggestSpecialities().length > 0 ||
      this.suggestPractitioners().length > 0 ||
      this.suggestOrganisations().length > 0,
  );

  constructor(
    private searchService: PractitionerSearchService,
    private specialityService: SpecialityService,
  ) {}

  ngOnInit(): void {
    this.watchSuggestInput();
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  onWhoInput(event: Event): void {
    const value = (event.target as HTMLInputElement).value;
    this.whoQuery.set(value);
    this.suggestOpen.set(true);
    this.suggestInput$.next(value);
  }

  onWhereInput(event: Event): void {
    this.whereQuery.set((event.target as HTMLInputElement).value);
  }

  onWhoFocus(): void {
    this.loadSpecialitiesOnce();
    this.suggestOpen.set(true);
  }

  // Emptying the term drops the practitioner and facility hits it produced;
  // the panel stays open on the plain speciality picker.
  clearWho(): void {
    this.whoQuery.set('');
    this.suggestPractitioners.set([]);
    this.suggestOrganisations.set([]);
    this.suggestInput$.next('');
    this.whoInput()?.nativeElement.focus();
    this.suggestOpen.set(true);
  }

  clearWhere(): void {
    this.whereQuery.set('');
    this.whereInput()?.nativeElement.focus();
  }

  closeSuggestions(): void {
    this.suggestOpen.set(false);
  }

  submit(): void {
    const who = this.whoQuery().trim();
    const where = this.whereQuery().trim();
    if (!who && !where) return;
    this.closeSuggestions();
    this.search.emit({ who, where });
  }

  selectSpeciality(speciality: Speciality): void {
    this.whoQuery.set(speciality.name);
    this.submit();
  }

  selectPractitioner(item: SearchItem): void {
    this.closeSuggestions();
    this.practitionerSelected.emit(item);
  }

  // An organisation has no profile page, so it just runs the search.
  selectOrganisation(item: SearchItem): void {
    this.whoQuery.set(item.name);
    this.submit();
  }

  // Splits a label around every occurrence of the typed term so the matching
  // chunks can be styled in the template.
  highlight(text: string): HighlightPart[] {
    const term = this.whoQuery().trim();
    if (!term) return [{ text, match: false }];

    const haystack = text.toLowerCase();
    const needle = term.toLowerCase();
    const parts: HighlightPart[] = [];
    let cursor = 0;

    while (cursor < text.length) {
      const found = haystack.indexOf(needle, cursor);
      if (found === -1) {
        parts.push({ text: text.slice(cursor), match: false });
        break;
      }
      if (found > cursor) {
        parts.push({ text: text.slice(cursor, found), match: false });
      }
      parts.push({ text: text.slice(found, found + needle.length), match: true });
      cursor = found + needle.length;
    }

    return parts;
  }

  private watchSuggestInput(): void {
    this.suggestInput$
      .pipe(
        debounceTime(250),
        distinctUntilChanged(),
        switchMap(term => {
          if (term.trim().length < SUGGEST_MIN_LENGTH) {
            this.isSuggestLoading.set(false);
            return of(null);
          }
          this.isSuggestLoading.set(true);
          return this.searchService
            .search({ who: term, where: '' })
            .pipe(catchError(() => of([] as SearchItem[])));
        }),
        takeUntil(this.destroy$),
      )
      .subscribe(items => {
        this.isSuggestLoading.set(false);
        if (!items) {
          this.suggestPractitioners.set([]);
          this.suggestOrganisations.set([]);
          return;
        }
        this.suggestPractitioners.set(
          items.filter(item => item.type === 'doctor').slice(0, SUGGEST_LIMIT),
        );
        this.suggestOrganisations.set(
          items.filter(item => item.type === 'organisation').slice(0, SUGGEST_LIMIT),
        );
      });
  }

  private loadSpecialitiesOnce(): void {
    if (this.specialitiesLoaded) return;
    this.specialitiesLoaded = true;
    this.specialityService
      .getSpecialities()
      .pipe(
        catchError(() => of([] as Speciality[])),
        takeUntil(this.destroy$),
      )
      .subscribe(specialities => this.allSpecialities.set(specialities || []));
  }
}
