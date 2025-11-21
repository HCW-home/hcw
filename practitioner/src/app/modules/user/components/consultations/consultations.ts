import { Component, OnInit, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { Router } from '@angular/router';
import { CommonModule } from '@angular/common';
import { Page } from '../../../../core/components/page/page';
import { Button } from '../../../../shared/ui-components/button/button';
import { Typography } from '../../../../shared/ui-components/typography/typography';
import { Tabs, TabItem } from '../../../../shared/components/tabs/tabs';
import { Badge } from '../../../../shared/components/badge/badge';
import {
  ButtonSizeEnum,
  ButtonStyleEnum,
} from '../../../../shared/constants/button';
import { TypographyTypeEnum } from '../../../../shared/constants/typography';
import { BadgeTypeEnum } from '../../../../shared/constants/badge';
import { Svg } from '../../../../shared/ui-components/svg/svg';
import { ConsultationService } from '../../../../core/services/consultation.service';
import { Consultation } from '../../../../core/models/consultation';
import { Loader } from '../../../../shared/components/loader/loader';
import { RoutePaths } from '../../../../core/constants/routes';

@Component({
  selector: 'app-consultations',
  imports: [CommonModule, Page, Button, Typography, Tabs, Badge, Svg, Loader],
  templateUrl: './consultations.html',
  styleUrl: './consultations.scss',
})
export class Consultations implements OnInit {
  breadcrumbs = [{ label: 'Consultations' }];

  activeTab = signal<'active' | 'past'>('active');
  activeConsultationsData = signal<Consultation[]>([]);
  pastConsultationsData = signal<Consultation[]>([]);
  loading = signal<boolean>(false);
  error = signal<string | null>(null);

  protected readonly ButtonSizeEnum = ButtonSizeEnum;
  protected readonly ButtonStyleEnum = ButtonStyleEnum;
  protected readonly TypographyTypeEnum = TypographyTypeEnum;
  protected readonly BadgeTypeEnum = BadgeTypeEnum;

  constructor(
    private router: Router,
    private consultationService: ConsultationService
  ) {}

  ngOnInit() {
    this.loadConsultations();
  }

  get activeConsultations(): Consultation[] {
    return this.activeConsultationsData();
  }

  get pastConsultations(): Consultation[] {
    return this.pastConsultationsData();
  }

  get tabItems(): TabItem[] {
    return [
      {
        id: 'active',
        label: 'Active Consultations',
        count: this.activeConsultations.length,
      },
      {
        id: 'past',
        label: 'Past Consultations',
        count: this.pastConsultations.length,
      },
    ];
  }

  setActiveTab(tab: string) {
    this.activeTab.set(tab as 'active' | 'past');
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
    return new Date(dateString).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  }

  private loadConsultations() {
    this.loading.set(true);
    this.error.set(null);

    const activeConsultations$ = this.consultationService.getConsultations({ is_closed: false });
    const pastConsultations$ = this.consultationService.getConsultations({ is_closed: true });

    Promise.all([
      firstValueFrom(activeConsultations$),
      firstValueFrom(pastConsultations$)
    ]).then(([activeResponse, pastResponse]) => {
      this.activeConsultationsData.set(activeResponse.results);
      this.pastConsultationsData.set(pastResponse.results);
      this.loading.set(false);
    }).catch((error) => {
      console.error('Error loading consultations:', error);
      this.error.set('Failed to load consultations. Please try again.');
      this.activeConsultationsData.set([]);
      this.pastConsultationsData.set([]);
      this.loading.set(false);
    });
  }
}
