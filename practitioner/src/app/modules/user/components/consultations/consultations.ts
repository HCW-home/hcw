import { Component, OnInit, OnDestroy, signal, inject } from '@angular/core';
import { Subject, takeUntil, debounceTime, distinctUntilChanged } from 'rxjs';
import { Router, ActivatedRoute } from '@angular/router';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Page } from '../../../../core/components/page/page';
import { Button } from '../../../../shared/ui-components/button/button';
import { Typography } from '../../../../shared/ui-components/typography/typography';
import { Input } from '../../../../shared/ui-components/input/input';
import { Tabs, TabItem } from '../../../../shared/components/tabs/tabs';
import { ListItem } from '../../../../shared/components/list-item/list-item';
import {
  ButtonSizeEnum,
  ButtonStyleEnum,
} from '../../../../shared/constants/button';
import { TypographyTypeEnum } from '../../../../shared/constants/typography';
import { Svg } from '../../../../shared/ui-components/svg/svg';
import { ConsultationService } from '../../../../core/services/consultation.service';
import { Consultation } from '../../../../core/models/consultation';
import { Loader } from '../../../../shared/components/loader/loader';
import { RoutePaths } from '../../../../core/constants/routes';
import { getErrorMessage } from '../../../../core/utils/error-helper';
import { ToasterService } from '../../../../core/services/toaster.service';

type ConsultationTabType = 'active' | 'past' | 'overdue';

interface TabCache {
  data: Consultation[];
  loaded: boolean;
  searchQuery: string;
  hasMore: boolean;
  currentPage: number;
}

@Component({
  selector: 'app-consultations',
  imports: [CommonModule, FormsModule, Page, Button, Typography, Input, Tabs, Svg, Loader, ListItem],
  templateUrl: './consultations.html',
  styleUrl: './consultations.scss',
})
export class Consultations implements OnInit, OnDestroy {
  private destroy$ = new Subject<void>();
  private searchSubject$ = new Subject<string>();
  private route = inject(ActivatedRoute);
  private toasterService = inject(ToasterService);

  private tabCache: Record<ConsultationTabType, TabCache> = {
    active: { data: [], loaded: false, searchQuery: '', hasMore: false, currentPage: 1 },
    past: { data: [], loaded: false, searchQuery: '', hasMore: false, currentPage: 1 },
    overdue: { data: [], loaded: false, searchQuery: '', hasMore: false, currentPage: 1 }
  };

  private pageSize = 20;

  activeTab = signal<ConsultationTabType>('active');
  consultations = signal<Consultation[]>([]);
  activeCount = signal(0);
  pastCount = signal(0);
  overdueCount = signal(0);
  loading = signal<boolean>(false);
  loadingMore = signal<boolean>(false);
  hasMore = signal<boolean>(false);
  error = signal<string | null>(null);
  searchQuery = '';

  protected readonly ButtonSizeEnum = ButtonSizeEnum;
  protected readonly ButtonStyleEnum = ButtonStyleEnum;
  protected readonly TypographyTypeEnum = TypographyTypeEnum;

  constructor(
    private router: Router,
    private consultationService: ConsultationService
  ) {}

  ngOnInit() {
    this.route.fragment.pipe(takeUntil(this.destroy$)).subscribe(fragment => {
      if (fragment === 'active' || fragment === 'past' || fragment === 'overdue') {
        this.activeTab.set(fragment);
        this.loadConsultations();
      }
    });

    this.loadConsultations();
    this.loadCounts();

    this.searchSubject$.pipe(
      debounceTime(300),
      distinctUntilChanged(),
      takeUntil(this.destroy$)
    ).subscribe(() => {
      this.invalidateCache();
      this.loadConsultations();
    });
  }

  ngOnDestroy() {
    this.destroy$.next();
    this.destroy$.complete();
  }

  get tabItems(): TabItem[] {
    return [
      { id: 'active', label: 'Active', count: this.activeCount() },
      { id: 'past', label: 'Closed', count: this.pastCount() },
      { id: 'overdue', label: 'Overdue', count: this.overdueCount() }
    ];
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
      return;
    }

    this.loading.set(true);
    this.error.set(null);

    if (currentTab === 'overdue') {
      const params: { search?: string; page_size?: number } = { page_size: this.pageSize };
      if (this.searchQuery) {
        params.search = this.searchQuery;
      }

      this.consultationService.getOverdueConsultations(params).pipe(
        takeUntil(this.destroy$)
      ).subscribe({
        next: (response) => {
          const hasMore = response.next !== null;
          this.consultations.set(response.results);
          this.hasMore.set(hasMore);
          this.tabCache[currentTab] = {
            data: response.results,
            loaded: true,
            searchQuery: this.searchQuery,
            hasMore,
            currentPage: 1
          };
          this.loading.set(false);
        },
        error: (err) => {
          this.toasterService.show('error', 'Error Loading Consultations', getErrorMessage(err));
          this.loading.set(false);
        }
      });
    } else {
      const params: { is_closed: boolean; search?: string; page_size?: number } = {
        is_closed: currentTab === 'past',
        page_size: this.pageSize
      };
      if (this.searchQuery) {
        params.search = this.searchQuery;
      }

      this.consultationService.getConsultations(params).pipe(
        takeUntil(this.destroy$)
      ).subscribe({
        next: (response) => {
          const hasMore = response.next !== null;
          this.consultations.set(response.results);
          this.hasMore.set(hasMore);
          this.tabCache[currentTab] = {
            data: response.results,
            loaded: true,
            searchQuery: this.searchQuery,
            hasMore,
            currentPage: 1
          };
          this.loading.set(false);
        },
        error: (err) => {
          this.toasterService.show('error', 'Error Loading Consultations', getErrorMessage(err));
          this.loading.set(false);
        }
      });
    }
  }

  loadMore(): void {
    if (this.loadingMore() || !this.hasMore()) return;

    const currentTab = this.activeTab();
    const cache = this.tabCache[currentTab];
    const nextPage = cache.currentPage + 1;

    this.loadingMore.set(true);

    if (currentTab === 'overdue') {
      const params: { search?: string; page_size?: number; page?: number } = {
        page_size: this.pageSize,
        page: nextPage
      };
      if (this.searchQuery) {
        params.search = this.searchQuery;
      }

      this.consultationService.getOverdueConsultations(params).pipe(
        takeUntil(this.destroy$)
      ).subscribe({
        next: (response) => {
          const hasMore = response.next !== null;
          const newData = [...cache.data, ...response.results];
          this.consultations.set(newData);
          this.hasMore.set(hasMore);
          this.tabCache[currentTab] = {
            ...cache,
            data: newData,
            hasMore,
            currentPage: nextPage
          };
          this.loadingMore.set(false);
        },
        error: (err) => {
          this.toasterService.show('error', 'Error Loading Consultations', getErrorMessage(err));
          this.loadingMore.set(false);
        }
      });
    } else {
      const params: { is_closed: boolean; search?: string; page_size?: number; page?: number } = {
        is_closed: currentTab === 'past',
        page_size: this.pageSize,
        page: nextPage
      };
      if (this.searchQuery) {
        params.search = this.searchQuery;
      }

      this.consultationService.getConsultations(params).pipe(
        takeUntil(this.destroy$)
      ).subscribe({
        next: (response) => {
          const hasMore = response.next !== null;
          const newData = [...cache.data, ...response.results];
          this.consultations.set(newData);
          this.hasMore.set(hasMore);
          this.tabCache[currentTab] = {
            ...cache,
            data: newData,
            hasMore,
            currentPage: nextPage
          };
          this.loadingMore.set(false);
        },
        error: (err) => {
          this.toasterService.show('error', 'Error Loading Consultations', getErrorMessage(err));
          this.loadingMore.set(false);
        }
      });
    }
  }

  viewConsultationDetails(consultation: Consultation) {
    this.router.navigate([`/${RoutePaths.USER}/${RoutePaths.CONSULTATIONS}`, consultation.id]);
  }

  editConsultation(consultation: Consultation) {
    this.router.navigate([`/${RoutePaths.USER}/${RoutePaths.CONSULTATIONS}`, consultation.id, 'edit']);
  }

  createConsultation() {
    this.router.navigate([`/${RoutePaths.USER}/${RoutePaths.CONSULTATIONS}/new`]);
  }

  retryLoadConsultations() {
    this.invalidateCache();
    this.loadConsultations();
  }

  getBeneficiaryName(consultation: Consultation): string {
    if (!consultation.beneficiary) return 'No Patient Assigned';

    const firstName = consultation.beneficiary.first_name?.trim() || '';
    const lastName = consultation.beneficiary.last_name?.trim() || '';
    const fullName = `${firstName} ${lastName}`.trim();

    return fullName || consultation.beneficiary.email || 'Unknown Patient';
  }

  getOwnerName(consultation: Consultation): string {
    if (!consultation.owned_by) return 'Unassigned';

    const firstName = consultation.owned_by.first_name?.trim() || '';
    const lastName = consultation.owned_by.last_name?.trim() || '';
    const fullName = `${firstName} ${lastName}`.trim();

    return fullName || consultation.owned_by.email || 'Unknown';
  }

  formatDate(dateString: string): string {
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

    if (diffDays === 0) {
      return 'Today, ' + date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
    } else if (diffDays === 1) {
      return 'Yesterday, ' + date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
    } else if (diffDays < 7) {
      return `${diffDays} days ago`;
    }
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  }

  getPatientInitials(consultation: Consultation): string {
    if (!consultation.beneficiary) return '?';
    const firstName = consultation.beneficiary.first_name?.trim() || '';
    const lastName = consultation.beneficiary.last_name?.trim() || '';
    const firstInitial = firstName.charAt(0).toUpperCase();
    const lastInitial = lastName.charAt(0).toUpperCase();
    return (firstInitial + lastInitial) || '?';
  }

  getConsultationSubtitle(consultation: Consultation): string {
    if (this.activeTab() === 'active') {
      return 'Created ' + this.formatDate(consultation.created_at);
    }
    return consultation.group?.name || 'Completed';
  }

  private invalidateCache(): void {
    this.tabCache = {
      active: { data: [], loaded: false, searchQuery: '', hasMore: false, currentPage: 1 },
      past: { data: [], loaded: false, searchQuery: '', hasMore: false, currentPage: 1 },
      overdue: { data: [], loaded: false, searchQuery: '', hasMore: false, currentPage: 1 }
    };
  }

  private loadCounts(): void {
    this.consultationService.getConsultations({ is_closed: false, page_size: 1 }).pipe(
      takeUntil(this.destroy$)
    ).subscribe({
      next: (response) => this.activeCount.set(response.count)
    });

    this.consultationService.getConsultations({ is_closed: true, page_size: 1 }).pipe(
      takeUntil(this.destroy$)
    ).subscribe({
      next: (response) => this.pastCount.set(response.count)
    });

    this.consultationService.getOverdueConsultations({ page_size: 1 }).pipe(
      takeUntil(this.destroy$)
    ).subscribe({
      next: (response) => this.overdueCount.set(response.count)
    });
  }
}
