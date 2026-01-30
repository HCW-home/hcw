import { Component, signal, inject, OnInit, OnDestroy } from '@angular/core';
import { Router } from '@angular/router';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Subject, takeUntil, debounceTime, distinctUntilChanged } from 'rxjs';
import { Page } from '../../../../core/components/page/page';
import { Svg } from '../../../../shared/ui-components/svg/svg';
import { Typography } from '../../../../shared/ui-components/typography/typography';
import { Button } from '../../../../shared/ui-components/button/button';
import { Input } from '../../../../shared/ui-components/input/input';
import { Loader } from '../../../../shared/components/loader/loader';
import { Badge } from '../../../../shared/components/badge/badge';
import { Tabs, TabItem } from '../../../../shared/components/tabs/tabs';
import { ListItem } from '../../../../shared/components/list-item/list-item';
import { ModalComponent } from '../../../../shared/components/modal/modal.component';
import { AddEditPatient } from '../add-edit-patient/add-edit-patient';
import { TypographyTypeEnum } from '../../../../shared/constants/typography';
import { ButtonSizeEnum, ButtonStyleEnum } from '../../../../shared/constants/button';
import { RoutePaths } from '../../../../core/constants/routes';
import { PatientService } from '../../../../core/services/patient.service';
import { ToasterService } from '../../../../core/services/toaster.service';
import { IUser } from '../../models/user';
import { getOnlineStatusBadgeType } from '../../../../shared/tools/helper';
import { getErrorMessage } from '../../../../core/utils/error-helper';

type PatientTabType = 'all' | 'registered' | 'temporary';

interface TabCache {
  data: IUser[];
  loaded: boolean;
  searchQuery: string;
}

@Component({
  selector: 'app-patients',
  imports: [CommonModule, FormsModule, Page, Svg, Typography, Button, Input, Loader, Badge, Tabs, ListItem, ModalComponent, AddEditPatient],
  templateUrl: './patients.html',
  styleUrl: './patients.scss',
})
export class Patients implements OnInit, OnDestroy {
  private destroy$ = new Subject<void>();
  private searchSubject$ = new Subject<string>();
  private patientService = inject(PatientService);
  private toasterService = inject(ToasterService);
  private router = inject(Router);

  private tabCache: Record<PatientTabType, TabCache> = {
    all: { data: [], loaded: false, searchQuery: '' },
    registered: { data: [], loaded: false, searchQuery: '' },
    temporary: { data: [], loaded: false, searchQuery: '' }
  };

  protected readonly TypographyTypeEnum = TypographyTypeEnum;
  protected readonly ButtonSizeEnum = ButtonSizeEnum;
  protected readonly ButtonStyleEnum = ButtonStyleEnum;
  protected readonly getOnlineStatusBadgeType = getOnlineStatusBadgeType;

  loading = signal(false);
  patients = signal<IUser[]>([]);
  totalCount = signal(0);
  permanentCount = signal(0);
  temporaryCount = signal(0);
  searchQuery = '';
  showAddModal = signal(false);
  activeTab = signal<PatientTabType>('all');

  get tabItems(): TabItem[] {
    return [
      { id: 'all', label: 'All', count: this.totalCount() },
      { id: 'registered', label: 'Permanent', count: this.permanentCount() },
      { id: 'temporary', label: 'Temporary', count: this.temporaryCount() }
    ];
  }

  ngOnInit(): void {
    this.loadPatients();
    this.loadCounts();

    this.searchSubject$.pipe(
      debounceTime(300),
      distinctUntilChanged(),
      takeUntil(this.destroy$)
    ).subscribe(query => {
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
      return;
    }

    this.loading.set(true);
    const params: { search?: string; page_size?: number; temporary?: boolean } = { page_size: 50 };
    if (this.searchQuery) {
      params.search = this.searchQuery;
    }

    if (currentTab === 'registered') {
      params.temporary = false;
    } else if (currentTab === 'temporary') {
      params.temporary = true;
    }

    this.patientService.getPatients(params).pipe(
      takeUntil(this.destroy$)
    ).subscribe({
      next: (response) => {
        this.patients.set(response.results);
        this.tabCache[currentTab] = {
          data: response.results,
          loaded: true,
          searchQuery: this.searchQuery
        };
        this.loading.set(false);
      },
      error: (err) => {
        this.toasterService.show('error', 'Error', getErrorMessage(err));
        this.loading.set(false);
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

  getInitials(patient: IUser): string {
    const first = patient.first_name?.charAt(0) || '';
    const last = patient.last_name?.charAt(0) || '';
    return (first + last).toUpperCase() || 'U';
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
      all: { data: [], loaded: false, searchQuery: '' },
      registered: { data: [], loaded: false, searchQuery: '' },
      temporary: { data: [], loaded: false, searchQuery: '' }
    };
  }

  private loadCounts(): void {
    this.patientService.getPatients({ page_size: 1 }).pipe(
      takeUntil(this.destroy$)
    ).subscribe({
      next: (response) => this.totalCount.set(response.count)
    });

    this.patientService.getPatients({ page_size: 1, temporary: false }).pipe(
      takeUntil(this.destroy$)
    ).subscribe({
      next: (response) => this.permanentCount.set(response.count)
    });

    this.patientService.getPatients({ page_size: 1, temporary: true }).pipe(
      takeUntil(this.destroy$)
    ).subscribe({
      next: (response) => this.temporaryCount.set(response.count)
    });
  }
}
