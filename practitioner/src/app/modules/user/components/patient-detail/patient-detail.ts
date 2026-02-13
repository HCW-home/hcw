import { Component, OnInit, OnDestroy, signal, inject } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { CommonModule, DatePipe } from '@angular/common';
import { Subject, takeUntil, forkJoin } from 'rxjs';
import { Page } from '../../../../core/components/page/page';
import { Svg } from '../../../../shared/ui-components/svg/svg';
import { Typography } from '../../../../shared/ui-components/typography/typography';
import { Button } from '../../../../shared/ui-components/button/button';
import { Loader } from '../../../../shared/components/loader/loader';
import { Tabs, TabItem } from '../../../../shared/components/tabs/tabs';
import { ModalComponent } from '../../../../shared/components/modal/modal.component';
import { AddEditPatient } from '../add-edit-patient/add-edit-patient';
import { TypographyTypeEnum } from '../../../../shared/constants/typography';
import { ButtonSizeEnum, ButtonStyleEnum } from '../../../../shared/constants/button';
import { IHealthMetric, IHealthMetricResponse } from '../../models/patient';
import { IUser } from '../../models/user';
import { RoutePaths } from '../../../../core/constants/routes';
import { PatientService } from '../../../../core/services/patient.service';
import { ConsultationService } from '../../../../core/services/consultation.service';
import { Consultation, Appointment } from '../../../../core/models/consultation';
import { ToasterService } from '../../../../core/services/toaster.service';
import { Badge } from '../../../../shared/components/badge/badge';
import { ConsultationRowItem } from '../../../../shared/components/consultation-row-item/consultation-row-item';
import { getConsultationBadgeType, getAppointmentBadgeType } from '../../../../shared/tools/helper';
import { getErrorMessage } from '../../../../core/utils/error-helper';

@Component({
  selector: 'app-patient-detail',
  imports: [CommonModule, DatePipe, Page, Svg, Typography, Button, Loader, Tabs, ModalComponent, AddEditPatient, Badge, ConsultationRowItem],
  templateUrl: './patient-detail.html',
  styleUrl: './patient-detail.scss',
})
export class PatientDetail implements OnInit, OnDestroy {
  private destroy$ = new Subject<void>();
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private patientService = inject(PatientService);
  private consultationService = inject(ConsultationService);
  private toasterService = inject(ToasterService);

  protected readonly TypographyTypeEnum = TypographyTypeEnum;
  protected readonly ButtonSizeEnum = ButtonSizeEnum;
  protected readonly ButtonStyleEnum = ButtonStyleEnum;
  protected readonly getConsultationBadgeType = getConsultationBadgeType;
  protected readonly getAppointmentBadgeType = getAppointmentBadgeType;

  patientId: number | null = null;
  activeTab = signal<'overview' | 'consultations' | 'appointments'>('overview');
  showEditModal = signal(false);
  loading = signal(true);
  loadingConsultations = signal(false);
  loadingAppointments = signal(false);

  patient = signal<IUser | null>(null);
  healthMetrics = signal<IHealthMetric[]>([]);
  consultations = signal<Consultation[]>([]);
  appointments = signal<Appointment[]>([]);

  tabItems: TabItem[] = [
    { id: 'overview', label: 'Overview' },
    { id: 'consultations', label: 'Consultations' },
    { id: 'appointments', label: 'Appointments' }
  ];

  ngOnInit(): void {
    this.route.fragment.pipe(takeUntil(this.destroy$)).subscribe(fragment => {
      if (fragment === 'overview' || fragment === 'consultations' || fragment === 'appointments') {
        this.activeTab.set(fragment);
      }
    });

    this.route.params.pipe(takeUntil(this.destroy$)).subscribe(params => {
      if (params['id']) {
        this.patientId = +params['id'];
        this.loadPatient();
        this.loadConsultations();
        this.loadAppointments();
      }
    });
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  loadPatient(): void {
    if (!this.patientId) return;

    this.loading.set(true);
    forkJoin({
      patient: this.patientService.getPatient(this.patientId),
    }).pipe(
      takeUntil(this.destroy$)
    ).subscribe({
      next: ({ patient }) => {
        this.patient.set(patient);
        // this.healthMetrics.set(this.transformHealthMetrics(healthMetrics.results));
        this.loading.set(false);
      },
      error: (err) => {
        this.toasterService.show('error', 'Error Loading Patient', getErrorMessage(err));
        this.loading.set(false);
      }
    });
  }

  loadConsultations(): void {
    if (!this.patientId) return;

    this.loadingConsultations.set(true);
    this.consultationService
      .getConsultations({ beneficiary: this.patientId })
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: response => {
          this.consultations.set(response.results);
          this.loadingConsultations.set(false);
        },
        error: (err) => {
          this.toasterService.show('error', 'Error Loading Consultations', getErrorMessage(err));
          this.loadingConsultations.set(false);
        }
      });
  }

  loadAppointments(): void {
    if (!this.patientId) return;

    this.loadingAppointments.set(true);
    this.consultationService
      .getAppointments({ consultation__beneficiary: this.patientId })
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: response => {
          this.appointments.set(response.results);
          this.loadingAppointments.set(false);
        },
        error: (err) => {
          this.toasterService.show('error', 'Error Loading Appointments', getErrorMessage(err));
          this.loadingAppointments.set(false);
        }
      });
  }

  private transformHealthMetrics(metrics: IHealthMetricResponse[]): IHealthMetric[] {
    if (!metrics.length) return [];

    const latestMetric = metrics[0];
    const displayMetrics: IHealthMetric[] = [];

    if (latestMetric.heart_rate_bpm !== null) {
      displayMetrics.push({
        id: 1,
        name: 'Heart Rate',
        value: latestMetric.heart_rate_bpm.toString(),
        unit: 'bpm',
        icon: 'heart',
        color: 'rose',
        trend: 'stable',
        lastUpdated: latestMetric.measured_at
      });
    }

    if (latestMetric.systolic_bp !== null && latestMetric.diastolic_bp !== null) {
      displayMetrics.push({
        id: 2,
        name: 'Blood Pressure',
        value: `${latestMetric.systolic_bp}/${latestMetric.diastolic_bp}`,
        unit: 'mmHg',
        icon: 'activity',
        color: 'purple',
        trend: 'stable',
        lastUpdated: latestMetric.measured_at
      });
    }

    if (latestMetric.temperature_c !== null) {
      displayMetrics.push({
        id: 3,
        name: 'Temperature',
        value: latestMetric.temperature_c.toString(),
        unit: 'C',
        icon: 'thermometer',
        color: 'amber',
        trend: 'stable',
        lastUpdated: latestMetric.measured_at
      });
    }

    if (latestMetric.weight_kg !== null) {
      displayMetrics.push({
        id: 4,
        name: 'Weight',
        value: latestMetric.weight_kg.toString(),
        unit: 'kg',
        icon: 'weight',
        color: 'blue',
        trend: 'stable',
        lastUpdated: latestMetric.measured_at
      });
    }

    if (latestMetric.spo2_pct !== null) {
      displayMetrics.push({
        id: 5,
        name: 'SpO2',
        value: latestMetric.spo2_pct.toString(),
        unit: '%',
        icon: 'activity',
        color: 'emerald',
        trend: 'stable',
        lastUpdated: latestMetric.measured_at
      });
    }

    if (latestMetric.glucose_fasting_mgdl !== null) {
      displayMetrics.push({
        id: 6,
        name: 'Glucose',
        value: latestMetric.glucose_fasting_mgdl.toString(),
        unit: 'mg/dL',
        icon: 'activity',
        color: 'cyan',
        trend: 'stable',
        lastUpdated: latestMetric.measured_at
      });
    }

    return displayMetrics;
  }

  getInitials(patient: IUser): string {
    const first = patient.first_name?.charAt(0) || '';
    const last = patient.last_name?.charAt(0) || '';
    return (first + last).toUpperCase() || 'U';
  }

  getFullName(patient: IUser): string {
    return `${patient.first_name || ''} ${patient.last_name || ''}`.trim() || patient.email;
  }

  setActiveTab(tab: string): void {
    this.activeTab.set(tab as 'overview' | 'consultations' | 'appointments');
    this.router.navigate([], { fragment: tab, replaceUrl: true });
  }

  goBack(): void {
    this.router.navigate([RoutePaths.USER, 'patients']);
  }

  startConsultation(): void {
    this.router.navigate([RoutePaths.USER, 'consultations', 'new']);
  }

  viewConsultation(consultation: Consultation): void {
    this.router.navigate([RoutePaths.USER, 'consultations', consultation.id]);
  }

  getAppointmentType(type: string): string {
    const t = type?.toLowerCase();
    switch (t) {
      case 'online': return 'Video Call';
      case 'inperson': return 'In Person';
      case 'in_person': return 'In Person';
      case 'phone': return 'Phone Call';
      default: return type;
    }
  }

  openEditModal(): void {
    this.showEditModal.set(true);
  }

  closeEditModal(): void {
    this.showEditModal.set(false);
  }

  onPatientSaved(): void {
    this.closeEditModal();
    this.loadPatient();
  }

  getTrendClass(trend: string): string {
    switch (trend) {
      case 'up': return 'trend-up';
      case 'down': return 'trend-down';
      default: return 'trend-stable';
    }
  }

  getMetricColorClass(color: string): string {
    return `metric-${color}`;
  }
}
