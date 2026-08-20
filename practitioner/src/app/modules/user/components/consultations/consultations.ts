import {
  Component,
  OnInit,
  OnDestroy,
  signal,
  inject,
  computed,
} from '@angular/core';
import { Subject, takeUntil, debounceTime, distinctUntilChanged } from 'rxjs';
import { Router, ActivatedRoute } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { Page } from '../../../../core/components/page/page';
import { Typography } from '../../../../shared/ui-components/typography/typography';
import { Input } from '../../../../shared/ui-components/input/input';
import { Tabs, TabItem } from '../../../../shared/components/tabs/tabs';
import {
  DataTable,
  DataTableColumn,
} from '../../../../shared/components/data-table/data-table';
import { DataTableCellDirective } from '../../../../shared/components/data-table/data-table-cell.directive';
import { UserAvatar } from '../../../../shared/components/user-avatar/user-avatar';
import { LocalDatePipe } from '../../../../shared/pipes/local-date.pipe';
import { TypographyTypeEnum } from '../../../../shared/constants/typography';
import { Svg } from '../../../../shared/ui-components/svg/svg';
import { Button } from '../../../../shared/ui-components/button/button';
import {
  ButtonSizeEnum,
  ButtonStyleEnum,
} from '../../../../shared/constants/button';
import { CreateConsultationModal } from '../create-consultation-modal/create-consultation-modal';
import {
  ConsultationService,
  ConsultationQueryParams,
} from '../../../../core/services/consultation.service';
import { UserWebSocketService } from '../../../../core/services/user-websocket.service';
import { Consultation, Queue } from '../../../../core/models/consultation';
import { RoutePaths } from '../../../../core/constants/routes';
import { getErrorMessage } from '../../../../core/utils/error-helper';
import {
  formatConsultationId,
  formatUserName,
} from '../../../../shared/tools/helper';
import { ToasterService } from '../../../../core/services/toaster.service';
import { TranslatePipe } from '@ngx-translate/core';
import { TranslationService } from '../../../../core/services/translation.service';
import { UserSearchSelect } from '../../../../shared/components/user-search-select/user-search-select';
import { UserService } from '../../../../core/services/user.service';
import { IUser } from '../../models/user';

type ConsultationTabType = 'active' | 'past' | 'overdue';

interface TabCache {
  data: Consultation[];
  loaded: boolean;
  searchQuery: string;
  hasMore: boolean;
  currentPage: number;
  total: number;
}

const EMPTY_TAB_CACHE: TabCache = {
  data: [],
  loaded: false,
  searchQuery: '',
  hasMore: false,
  currentPage: 1,
  total: 0,
};

@Component({
  selector: 'app-consultations',
  imports: [
    FormsModule,
    Page,
    Typography,
    Input,
    Tabs,
    Svg,
    Button,
    CreateConsultationModal,
    DataTable,
    DataTableCellDirective,
    UserAvatar,
    LocalDatePipe,
    TranslatePipe,
    UserSearchSelect,
  ],
  templateUrl: './consultations.html',
  styleUrl: './consultations.scss',
})
export class Consultations implements OnInit, OnDestroy {
  private destroy$ = new Subject<void>();
  private searchSubject$ = new Subject<string>();
  private route = inject(ActivatedRoute);
  private toasterService = inject(ToasterService);
  private t = inject(TranslationService);
  private userService = inject(UserService);
  private userWsService = inject(UserWebSocketService);

  private tabCache: Record<ConsultationTabType, TabCache> = {
    active: { ...EMPTY_TAB_CACHE },
    past: { ...EMPTY_TAB_CACHE },
    overdue: { ...EMPTY_TAB_CACHE },
  };

  private pageSize = 20;

  activeTab = signal<ConsultationTabType>('overdue');
  consultations = signal<Consultation[]>([]);
  activeCount = signal(0);
  pastCount = signal(0);
  overdueCount = signal(0);
  totalCount = signal(0);
  loading = signal<boolean>(false);
  loadingMore = signal<boolean>(false);
  hasMore = signal<boolean>(false);
  error = signal<string | null>(null);
  searchQuery = '';

  currentUser = signal<IUser | null>(null);

  // Filters
  showFilters = signal(false);
  queues = signal<Queue[]>([]);
  filterBeneficiary = signal<number | null>(null);
  filterCreatedBy = signal<number | null>(null);
  filterOwnedBy = signal<number | null>(null);
  filterGroup = signal<number | null>(null);
  filterBeneficiaryUser = signal<IUser | null>(null);
  filterCreatedByUser = signal<IUser | null>(null);
  filterOwnedByUser = signal<IUser | null>(null);
  activeFilterCount = computed(() => {
    let count = 0;
    if (this.filterBeneficiary()) count++;
    if (this.filterCreatedBy()) count++;
    if (this.filterOwnedBy()) count++;
    if (this.filterGroup()) count++;
    return count;
  });

  showCreateConsultationModal = signal(false);

  protected readonly TypographyTypeEnum = TypographyTypeEnum;
  protected readonly ButtonSizeEnum = ButtonSizeEnum;
  protected readonly ButtonStyleEnum = ButtonStyleEnum;

  columns = computed<DataTableColumn[]>(() => {
    // Read the language so headers are rebuilt when the user switches locale.
    this.t.currentLanguage();
    const columns: DataTableColumn[] = [
      {
        key: 'title',
        label: this.t.instant('consultations.columnFollowUp'),
        width: 'minmax(240px, 2.4fr)',
        wrap: true,
      },
      {
        key: 'patient',
        label: this.t.instant('consultationRowItem.patient'),
        width: 'minmax(150px, 1.2fr)',
      },
      {
        key: 'createdBy',
        label: this.t.instant('consultationRowItem.createdBy'),
        width: 'minmax(120px, 1fr)',
      },
      {
        key: 'practitioner',
        label: this.t.instant('consultationRowItem.practitioner'),
        width: 'minmax(120px, 1fr)',
      },
      {
        key: 'group',
        label: this.t.instant('consultations.group'),
        width: 'minmax(120px, 1fr)',
      },
      {
        key: 'created',
        label: this.t.instant('consultations.columnCreatedAt'),
        width: 'minmax(150px, 1.1fr)',
      },
    ];
    if (this.activeTab() === 'past') {
      columns.push({
        key: 'closed',
        label: this.t.instant('consultationRowItem.closed'),
        width: 'minmax(150px, 1.1fr)',
      });
    }
    columns.push({
      key: 'chevron',
      width: '24px',
      align: 'end',
      hideOnMobile: true,
    });
    return columns;
  });

  summaryText = computed(() => {
    this.t.currentLanguage();
    return this.t.instant('consultations.resultsSummary', {
      shown: String(this.consultations().length),
      total: String(this.totalCount()),
    });
  });

  constructor(
    private router: Router,
    private consultationService: ConsultationService
  ) {}

  ngOnInit() {
    this.route.fragment.pipe(takeUntil(this.destroy$)).subscribe(fragment => {
      if (
        fragment === 'active' ||
        fragment === 'past' ||
        fragment === 'overdue'
      ) {
        this.activeTab.set(fragment);
      }
      this.loadConsultations();
    });

    this.loadCounts();
    this.loadQueues();

    this.userService.currentUser$
      .pipe(takeUntil(this.destroy$))
      .subscribe(user => this.currentUser.set(user));

    this.searchSubject$
      .pipe(debounceTime(300), distinctUntilChanged(), takeUntil(this.destroy$))
      .subscribe(() => {
        this.invalidateCache();
        this.loadConsultations();
      });

    this.userWsService.consultationEvent$
      .pipe(takeUntil(this.destroy$))
      .subscribe(() => {
        this.invalidateCache();
        this.loadConsultations();
        this.loadCounts();
      });

    this.userWsService.consultationMessage$
      .pipe(takeUntil(this.destroy$))
      .subscribe(event => {
        if (event.state !== 'created') return;
        const senderId = event.data?.created_by?.id;
        const currentUserId = this.currentUser()?.pk;
        if (senderId && senderId !== currentUserId) {
          this.patchConsultation(event.consultation_id, c => ({
            ...c,
            unread_count: (c.unread_count || 0) + 1,
          }));
        }
      });
  }

  ngOnDestroy() {
    this.destroy$.next();
    this.destroy$.complete();
  }

  get tabItems(): TabItem[] {
    return [
      {
        id: 'overdue',
        label: this.t.instant('consultations.tabOverdue'),
        count: this.overdueCount(),
      },
      {
        id: 'active',
        label: this.t.instant('consultations.tabActive'),
        count: this.activeCount(),
      },
      {
        id: 'past',
        label: this.t.instant('consultations.tabClosed'),
        count: this.pastCount(),
      },
    ];
  }

  toggleFilters(): void {
    this.showFilters.update(v => !v);
  }

  onSearchChange(query: string): void {
    this.searchQuery = query;
    this.searchSubject$.next(query);
  }

  setActiveTab(tab: string) {
    this.activeTab.set(tab as ConsultationTabType);
    this.router.navigate([], { fragment: tab, replaceUrl: true });
    this.loadConsultations();
  }

  loadConsultations(): void {
    const currentTab = this.activeTab();
    const cache = this.tabCache[currentTab];

    if (cache.loaded && cache.searchQuery === this.searchQuery) {
      this.consultations.set(cache.data);
      this.hasMore.set(cache.hasMore);
      this.totalCount.set(cache.total);
      return;
    }

    this.loading.set(true);
    this.error.set(null);

    this.consultationService
      .getConsultations(this.buildQueryParams(currentTab))
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: response => {
          const hasMore = response.next !== null;
          this.consultations.set(response.results);
          this.hasMore.set(hasMore);
          this.totalCount.set(response.count);
          this.tabCache[currentTab] = {
            data: response.results,
            loaded: true,
            searchQuery: this.searchQuery,
            hasMore,
            currentPage: 1,
            total: response.count,
          };
          this.loading.set(false);
        },
        error: err => {
          const message = getErrorMessage(err);
          this.error.set(message);
          this.toasterService.show(
            'error',
            this.t.instant('consultations.errorLoading'),
            message
          );
          this.loading.set(false);
        },
      });
  }

  loadMore(): void {
    if (this.loadingMore() || !this.hasMore()) return;

    const currentTab = this.activeTab();
    const cache = this.tabCache[currentTab];
    const nextPage = cache.currentPage + 1;

    this.loadingMore.set(true);

    this.consultationService
      .getConsultations({
        ...this.buildQueryParams(currentTab),
        page: nextPage,
      })
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: response => {
          const hasMore = response.next !== null;
          const newData = [...cache.data, ...response.results];
          this.consultations.set(newData);
          this.hasMore.set(hasMore);
          this.totalCount.set(response.count);
          this.tabCache[currentTab] = {
            ...cache,
            data: newData,
            hasMore,
            currentPage: nextPage,
            total: response.count,
          };
          this.loadingMore.set(false);
        },
        error: err => {
          this.toasterService.show(
            'error',
            this.t.instant('consultations.errorLoading'),
            getErrorMessage(err)
          );
          this.loadingMore.set(false);
        },
      });
  }

  viewConsultationDetails(consultation: Consultation) {
    this.router.navigate([
      `/${RoutePaths.USER}/${RoutePaths.CONSULTATIONS}`,
      consultation.id,
    ]);
  }

  editConsultation(consultation: Consultation) {
    this.router.navigate([
      `/${RoutePaths.USER}/${RoutePaths.CONSULTATIONS}`,
      consultation.id,
      'edit',
    ]);
  }

  openCreateConsultation(): void {
    this.showCreateConsultationModal.set(true);
  }

  closeCreateConsultation(): void {
    this.showCreateConsultationModal.set(false);
  }

  onConsultationCreated(): void {
    this.showCreateConsultationModal.set(false);
    this.invalidateCache();
    this.loadConsultations();
  }

  createConsultation() {
    this.router.navigate([
      `/${RoutePaths.USER}/${RoutePaths.CONSULTATIONS}/new`,
    ]);
  }

  retryLoadConsultations() {
    this.invalidateCache();
    this.loadConsultations();
  }

  protected readonly formatConsultationId = formatConsultationId;

  getBeneficiaryName(consultation: Consultation): string {
    return formatUserName(consultation.beneficiary);
  }

  getCreatedByName(consultation: Consultation): string {
    return formatUserName(consultation.created_by);
  }

  getOwnerName(consultation: Consultation): string {
    return formatUserName(consultation.owned_by);
  }

  /** Rail colour: amber warns about an unassigned follow-up, grey marks a closed one. */
  readonly rowAccent = (consultation: Consultation): string => {
    if (this.activeTab() === 'past') return 'var(--slate-300)';
    if (!consultation.owned_by) return 'var(--amber-400)';
    return 'var(--emerald-500)';
  };

  readonly trackConsultation = (consultation: Consultation): number =>
    consultation.id;

  private buildQueryParams(tab: ConsultationTabType): ConsultationQueryParams {
    const params: ConsultationQueryParams = {
      page_size: this.pageSize,
      ...this.getFilterParams(),
    };
    if (tab === 'overdue') {
      params['is_closed'] = false;
      params['scheduled'] = false;
    } else if (tab === 'active') {
      params['is_closed'] = false;
      params['scheduled'] = true;
    } else {
      params['is_closed'] = true;
    }
    if (this.searchQuery) {
      params['search'] = this.searchQuery;
    }
    return params;
  }

  /**
   * Apply a change to the rows on screen and to every tab cache. Updating
   * only the displayed list would be undone by the next tab switch, which
   * restores the cached snapshot taken before the change.
   */
  private patchConsultation(
    id: number,
    patch: (consultation: Consultation) => Consultation
  ): void {
    this.consultations.update(list =>
      list.map(c => (c.id === id ? patch(c) : c))
    );

    (Object.keys(this.tabCache) as ConsultationTabType[]).forEach(tab => {
      const cache = this.tabCache[tab];
      if (!cache.loaded) return;
      this.tabCache[tab] = {
        ...cache,
        data: cache.data.map(c => (c.id === id ? patch(c) : c)),
      };
    });
  }

  private invalidateCache(): void {
    this.tabCache = {
      active: { ...EMPTY_TAB_CACHE },
      past: { ...EMPTY_TAB_CACHE },
      overdue: { ...EMPTY_TAB_CACHE },
    };
  }

  onBeneficiaryChange(user: IUser | null): void {
    this.filterBeneficiary.set(user?.pk ?? null);
    this.filterBeneficiaryUser.set(user);
    this.applyFilters();
  }

  onCreatedByChange(user: IUser | null): void {
    this.filterCreatedBy.set(user?.pk ?? null);
    this.filterCreatedByUser.set(user);
    this.applyFilters();
  }

  onOwnedByChange(user: IUser | null): void {
    this.filterOwnedBy.set(user?.pk ?? null);
    this.filterOwnedByUser.set(user);
    this.applyFilters();
  }

  onGroupChange(event: Event): void {
    const value = (event.target as HTMLSelectElement).value;
    this.filterGroup.set(value ? +value : null);
    this.applyFilters();
  }

  private applyFilters(): void {
    this.invalidateCache();
    this.loadConsultations();
    this.loadCounts();
  }

  private getFilterParams(): Record<string, number> {
    const params: Record<string, number> = {};
    if (this.filterBeneficiary())
      params['beneficiary'] = this.filterBeneficiary()!;
    if (this.filterCreatedBy()) params['created_by'] = this.filterCreatedBy()!;
    if (this.filterOwnedBy()) params['owned_by'] = this.filterOwnedBy()!;
    if (this.filterGroup()) params['group'] = this.filterGroup()!;
    return params;
  }

  private loadQueues(): void {
    this.consultationService
      .getQueues()
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: queues => this.queues.set(queues),
      });
  }

  private loadCounts(): void {
    const filters = this.getFilterParams();

    this.consultationService
      .getConsultations({
        is_closed: false,
        scheduled: true,
        page_size: 1,
        ...filters,
      })
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: response => this.activeCount.set(response.count),
      });

    this.consultationService
      .getConsultations({ is_closed: true, page_size: 1, ...filters })
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: response => this.pastCount.set(response.count),
      });

    this.consultationService
      .getConsultations({
        is_closed: false,
        scheduled: false,
        page_size: 1,
        ...filters,
      })
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: response => this.overdueCount.set(response.count),
      });
  }
}
