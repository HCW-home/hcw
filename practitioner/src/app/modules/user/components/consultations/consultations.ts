import { Component, OnInit, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { Router } from '@angular/router';
import { Page } from '../../../../core/components/page/page';
import { Breadcrumb } from '../../../../shared/components/breadcrumb/breadcrumb';
import { Button } from '../../../../shared/ui-components/button/button';
import { Typography } from '../../../../shared/ui-components/typography/typography';
import { Tabs, TabItem } from '../../../../shared/components/tabs/tabs';
import { ConsultationCard } from '../../../../shared/components/consultation-card/consultation-card';
import { IConsultation } from '../../models/consultation';
import {
  ButtonSizeEnum,
  ButtonStyleEnum,
} from '../../../../shared/constants/button';
import { TypographyTypeEnum } from '../../../../shared/constants/typography';
import { Svg } from '../../../../shared/ui-components/svg/svg';
import { ConsultationService } from '../../../../core/services/consultation.service';
import { ConsultationMapperService } from '../../services/consultation-mapper.service';
import { Loader } from '../../../../shared/components/loader/loader';
import { RoutePaths } from '../../../../core/constants/routes';

@Component({
  selector: 'app-consultations',
  imports: [Page, Breadcrumb, Button, Typography, Tabs, ConsultationCard, Svg, Loader],
  templateUrl: './consultations.html',
  styleUrl: './consultations.scss',
})
export class Consultations implements OnInit {
  breadcrumbs = [{ label: 'Consultations' }];

  activeTab = signal<'active' | 'past'>('active');
  activeConsultationsData = signal<IConsultation[]>([]);
  pastConsultationsData = signal<IConsultation[]>([]);
  loading = signal<boolean>(false);
  error = signal<string | null>(null);

  protected readonly ButtonSizeEnum = ButtonSizeEnum;
  protected readonly ButtonStyleEnum = ButtonStyleEnum;
  protected readonly TypographyTypeEnum = TypographyTypeEnum;

  constructor(
    private router: Router,
    private consultationService: ConsultationService,
    private consultationMapper: ConsultationMapperService
  ) {}

  ngOnInit() {
    this.loadConsultations();
  }

  get activeConsultations(): IConsultation[] {
    return this.activeConsultationsData();
  }

  get pastConsultations(): IConsultation[] {
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

  joinConsultation(consultation: IConsultation) {
    console.log('Joining consultation:', consultation.id);
  }

  viewConsultationDetails(consultation: IConsultation) {
    this.router.navigate([`/${RoutePaths.USER}/${RoutePaths.CONSULTATIONS}`, consultation.id]);
  }

  scheduleFollowUp(consultation: IConsultation) {
    console.log('Scheduling follow-up for:', consultation.id);
  }

  createConsultation() {
    this.router.navigate([`/${RoutePaths.USER}/${RoutePaths.CONSULTATIONS}/new`]);
  }

  retryLoadConsultations() {
    this.loadConsultations();
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
      const activeUiConsultations = this.consultationMapper.mapToUIConsultations(activeResponse.results);
      const pastUiConsultations = this.consultationMapper.mapToUIConsultations(pastResponse.results);

      this.activeConsultationsData.set(activeUiConsultations);
      this.pastConsultationsData.set(pastUiConsultations);
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
