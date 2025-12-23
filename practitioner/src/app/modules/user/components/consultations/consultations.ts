import { Component, OnInit, OnDestroy, signal, inject } from '@angular/core';
import { firstValueFrom, Subject, takeUntil } from 'rxjs';
import { Router, ActivatedRoute } from '@angular/router';
import { CommonModule } from '@angular/common';
import { Page } from '../../../../core/components/page/page';
import { Button } from '../../../../shared/ui-components/button/button';
import { Typography } from '../../../../shared/ui-components/typography/typography';
import { Tabs, TabItem } from '../../../../shared/components/tabs/tabs';
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

@Component({
  selector: 'app-consultations',
  imports: [CommonModule, Page, Button, Typography, Tabs, Svg, Loader],
  templateUrl: './consultations.html',
  styleUrl: './consultations.scss',
})
export class Consultations implements OnInit, OnDestroy {
  private destroy$ = new Subject<void>();
  private route = inject(ActivatedRoute);

  breadcrumbs = [{ label: 'Consultations' }];

  activeTab = signal<'active' | 'past' | 'overdue'>('active');
  activeConsultationsData = signal<Consultation[]>([]);
  pastConsultationsData = signal<Consultation[]>([]);
  overdueConsultationsData = signal<Consultation[]>([]);
  loading = signal<boolean>(false);
  error = signal<string | null>(null);

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
      }
    });

    this.loadConsultations();
  }

  ngOnDestroy() {
    this.destroy$.next();
    this.destroy$.complete();
  }

  get activeConsultations(): Consultation[] {
    return this.activeConsultationsData();
  }

  get pastConsultations(): Consultation[] {
    return this.pastConsultationsData();
  }

  get overdueConsultations(): Consultation[] {
    return this.overdueConsultationsData();
  }

  get tabItems(): TabItem[] {
    return [
      {
        id: 'active',
        label: 'Active',
        count: this.activeConsultations.length,
      },
      {
        id: 'past',
        label: 'Closed',
        count: this.pastConsultations.length,
      },
      {
        id: 'overdue',
        label: 'Overdue',
        count: this.overdueConsultations.length,
      },
    ];
  }

  get currentConsultations(): Consultation[] {
    return this.activeTab() === 'active' ? this.activeConsultations : this.pastConsultations;
  }

  setActiveTab(tab: string) {
    this.activeTab.set(tab as 'active' | 'past' | 'overdue');
    this.router.navigate([], { fragment: tab, replaceUrl: true });
    if (tab === 'overdue') {
      this.loadOverdueConsultations();
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

  private loadConsultations() {
    this.loading.set(true);
    this.error.set(null);

    const activeConsultations$ = this.consultationService.getConsultations({ is_closed: false });
    const pastConsultations$ = this.consultationService.getConsultations({ is_closed: true });
    const overdueConsultations$ = this.consultationService.getOverdueConsultations();

    Promise.all([
      firstValueFrom(activeConsultations$),
      firstValueFrom(pastConsultations$),
      firstValueFrom(overdueConsultations$)
    ]).then(([activeResponse, pastResponse, overdueResponse]) => {
      this.activeConsultationsData.set(activeResponse.results);
      this.pastConsultationsData.set(pastResponse.results);
      this.overdueConsultationsData.set(overdueResponse.results);
      this.loading.set(false);
    }).catch((error) => {
      this.error.set(getErrorMessage(error));
      this.activeConsultationsData.set([]);
      this.pastConsultationsData.set([]);
      this.overdueConsultationsData.set([]);
      this.loading.set(false);
    });
  }

  private loadOverdueConsultations() {
    this.loading.set(true);
    this.error.set(null);

    this.consultationService.getOverdueConsultations().pipe(
      takeUntil(this.destroy$)
    ).subscribe({
      next: (response) => {
        this.overdueConsultationsData.set(response.results);
        this.loading.set(false);
      },
      error: (error) => {
        this.error.set(getErrorMessage(error));
        this.overdueConsultationsData.set([]);
        this.loading.set(false);
      }
    });
  }
}
