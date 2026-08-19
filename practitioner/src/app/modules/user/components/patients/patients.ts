import {
  Component,
  signal,
  inject,
  computed,
  OnInit,
  OnDestroy,
} from '@angular/core';
import { Router } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { Subject, takeUntil, debounceTime, distinctUntilChanged } from 'rxjs';
import { Page } from '../../../../core/components/page/page';
import { Svg } from '../../../../shared/ui-components/svg/svg';
import { Typography } from '../../../../shared/ui-components/typography/typography';
import { Button } from '../../../../shared/ui-components/button/button';
import { Input } from '../../../../shared/ui-components/input/input';
import { Badge } from '../../../../shared/components/badge/badge';
import { Tabs, TabItem } from '../../../../shared/components/tabs/tabs';
import {
  DataTable,
  DataTableColumn,
} from '../../../../shared/components/data-table/data-table';
import { DataTableCellDirective } from '../../../../shared/components/data-table/data-table-cell.directive';
import { UserAvatar } from '../../../../shared/components/user-avatar/user-avatar';
import { ModalComponent } from '../../../../shared/components/modal/modal.component';
import { AddEditPatient } from '../add-edit-patient/add-edit-patient';
import { TypographyTypeEnum } from '../../../../shared/constants/typography';
import { ButtonSizeEnum, ButtonStyleEnum } from '../../../../shared/constants/button';
import { BadgeTypeEnum } from '../../../../shared/constants/badge';
import { RoutePaths } from '../../../../core/constants/routes';
import {
  PatientService,
  IPatientQueryParams,
} from '../../../../core/services/patient.service';
import { ToasterService } from '../../../../core/services/toaster.service';
import { IUser } from '../../models/user';
import { getOnlineStatusBadgeType } from '../../../../shared/tools/helper';
import { getErrorMessage } from '../../../../core/utils/error-helper';
import { TranslatePipe } from '@ngx-translate/core';
import { TranslationService } from '../../../../core/services/translation.service';

type PatientTabType = 'all' | 'patients' | 'practitioners';

interface TabCache {
  data: IUser[];
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
  selector: 'app-patients',
  imports: [
    FormsModule,
    Page,
    Svg,
    Typography,
    Button,
    Input,
    Badge,
    Tabs,
    DataTable,
    DataTableCellDirective,
    UserAvatar,
    ModalComponent,
    AddEditPatient,
    TranslatePipe,
  ],
  templateUrl: './patients.html',
  styleUrl: './patients.scss',
})
export class Patients implements OnInit, OnDestroy {
  private destroy$ = new Subject<void>();
  private searchSubject$ = new Subject<string>();
  private patientService = inject(PatientService);
  private toasterService = inject(ToasterService);
  private router = inject(Router);
  private t = inject(TranslationService);

  private tabCache: Record<PatientTabType, TabCache> = {
    all: { ...EMPTY_TAB_CACHE },
    patients: { ...EMPTY_TAB_CACHE },
    practitioners: { ...EMPTY_TAB_CACHE },
  };

  private pageSize = 20;

  protected readonly TypographyTypeEnum = TypographyTypeEnum;
  protected readonly ButtonSizeEnum = ButtonSizeEnum;
  protected readonly ButtonStyleEnum = ButtonStyleEnum;
  protected readonly BadgeTypeEnum = BadgeTypeEnum;
  protected readonly getOnlineStatusBadgeType = getOnlineStatusBadgeType;

  loading = signal(false);
  loadingMore = signal(false);
  hasMore = signal(false);
  patients = signal<IUser[]>([]);
  totalCount = signal(0);
  patientCount = signal(0);
  practitionerCount = signal(0);
  searchQuery = '';
  showAddModal = signal(false);
  activeTab = signal<PatientTabType>('patients');
  resultTotal = signal(0);

  columns = computed<DataTableColumn[]>(() => {
    // Read the language so headers are rebuilt when the user switches locale.
    this.t.currentLanguage();
    return [
      {
        key: 'contact',
        label: this.t.instant('patients.columnContact'),
        width: 'minmax(210px, 2fr)',
      },
      {
        key: 'email',
        label: this.t.instant('patients.columnEmail'),
        width: 'minmax(180px, 1.6fr)',
      },
      {
        key: 'phone',
        label: this.t.instant('patients.columnPhone'),
        width: 'minmax(130px, 1fr)',
      },
      {
        key: 'type',
        label: this.t.instant('patients.columnType'),
        width: 'minmax(140px, 1fr)',
      },
      {
        key: 'status',
        label: this.t.instant('patients.columnStatus'),
        width: 'minmax(100px, 0.8fr)',
        align: 'end',
      },
      { key: 'chevron', width: '24px', align: 'end', hideOnMobile: true },
    ];
  });

  summaryText = computed(() => {
    this.t.currentLanguage();
    return this.t.instant('patients.resultsSummary', {
      shown: String(this.patients().length),
      total: String(this.resultTotal()),
    });
  });

  /** Rail colour: tells practitioners, temporary invitees and patients apart. */
  readonly rowAccent = (patient: IUser): string => {
    if (patient.temporary) return 'var(--amber-400)';
    if (patient.is_practitioner) return 'var(--primary-400)';
    return 'var(--emerald-500)';
  };

  readonly trackPatient = (patient: IUser): number => patient.pk;

  get tabItems(): TabItem[] {
    return [
      { id: 'patients', label: this.t.instant('patients.tabPatients'), count: this.patientCount() },
      { id: 'practitioners', label: this.t.instant('patients.tabPractitioners'), count: this.practitionerCount() },
      { id: 'all', label: this.t.instant('patients.tabAll'), count: this.totalCount() }
    ];
  }

  ngOnInit(): void {
    this.loadPatients();
    this.loadCounts();

    this.searchSubject$.pipe(
      debounceTime(300),
      distinctUntilChanged(),
      takeUntil(this.destroy$)
    ).subscribe(() => {
      this.invalidateCache();
      this.loadPatients();
    });
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  loadPatients(): void {
    const currentTab = this.activeTab();
    const cache = this.tabCache[currentTab];

    if (cache.loaded && cache.searchQuery === this.searchQuery) {
      this.patients.set(cache.data);
      this.hasMore.set(cache.hasMore);
      this.resultTotal.set(cache.total);
      return;
    }

    this.loading.set(true);

    this.patientService.getPatients(this.buildQueryParams(currentTab)).pipe(
      takeUntil(this.destroy$)
    ).subscribe({
      next: (response) => {
        const hasMore = response.next !== null;
        this.patients.set(response.results);
        this.hasMore.set(hasMore);
        this.resultTotal.set(response.count);
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
      error: (err) => {
        this.toasterService.show('error', this.t.instant('patients.errorLoading'), getErrorMessage(err));
        this.loading.set(false);
      }
    });
  }

  /** Link-only invitees have no email and no phone: they are not contacts. */
  private buildQueryParams(tab: PatientTabType): IPatientQueryParams {
    const params: IPatientQueryParams = {
      page_size: this.pageSize,
      has_contact_info: true,
    };
    if (this.searchQuery) {
      params.search = this.searchQuery;
    }
    if (tab === 'patients') {
      params.is_practitioner = false;
    } else if (tab === 'practitioners') {
      params.is_practitioner = true;
    }
    return params;
  }

  loadMore(): void {
    if (this.loadingMore() || !this.hasMore()) return;

    const currentTab = this.activeTab();
    const cache = this.tabCache[currentTab];
    const nextPage = cache.currentPage + 1;

    this.loadingMore.set(true);

    this.patientService.getPatients({
      ...this.buildQueryParams(currentTab),
      page: nextPage,
    }).pipe(
      takeUntil(this.destroy$)
    ).subscribe({
      next: (response) => {
        const hasMore = response.next !== null;
        const newData = [...cache.data, ...response.results];
        this.patients.set(newData);
        this.hasMore.set(hasMore);
        this.resultTotal.set(response.count);
        this.tabCache[currentTab] = {
          ...cache,
          data: newData,
          hasMore,
          currentPage: nextPage,
          total: response.count,
        };
        this.loadingMore.set(false);
      },
      error: (err) => {
        this.toasterService.show('error', this.t.instant('patients.errorLoading'), getErrorMessage(err));
        this.loadingMore.set(false);
      }
    });
  }

  setActiveTab(tabId: string): void {
    this.activeTab.set(tabId as PatientTabType);
    this.loadPatients();
  }

  onSearchChange(query: string): void {
    this.searchQuery = query;
    this.searchSubject$.next(query);
  }

  getFullName(patient: IUser): string {
    return `${patient.first_name || ''} ${patient.last_name || ''}`.trim() || patient.email;
  }

  viewPatient(patient: IUser): void {
    this.router.navigate([RoutePaths.USER, 'patients', patient.pk]);
  }

  openAddModal(): void {
    this.showAddModal.set(true);
  }

  closeAddModal(): void {
    this.showAddModal.set(false);
  }

  onPatientCreated(): void {
    this.closeAddModal();
    this.invalidateCache();
    this.loadPatients();
    this.loadCounts();
  }

  private invalidateCache(): void {
    this.tabCache = {
      all: { ...EMPTY_TAB_CACHE },
      patients: { ...EMPTY_TAB_CACHE },
      practitioners: { ...EMPTY_TAB_CACHE },
    };
  }

  private loadCounts(): void {
    // Same filter as the list, otherwise the tab counters would include the
    // link-only invitees that are hidden from the rows.
    this.patientService.getPatients({ page_size: 1, has_contact_info: true }).pipe(
      takeUntil(this.destroy$)
    ).subscribe({
      next: (response) => this.totalCount.set(response.count)
    });

    this.patientService.getPatients({ page_size: 1, is_practitioner: false, has_contact_info: true }).pipe(
      takeUntil(this.destroy$)
    ).subscribe({
      next: (response) => this.patientCount.set(response.count)
    });

    this.patientService.getPatients({ page_size: 1, is_practitioner: true, has_contact_info: true }).pipe(
      takeUntil(this.destroy$)
    ).subscribe({
      next: (response) => this.practitionerCount.set(response.count)
    });
  }
}
