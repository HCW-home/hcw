import { Component, OnInit, OnDestroy, signal, inject } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { CommonModule } from '@angular/common';
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
import { IHealthMetric, IHealthMetricResponse, IPatientAppointment, IPatientConsultation } from '../../models/patient';
import { IUser } from '../../models/user';
import { RoutePaths } from '../../../../core/constants/routes';
import { PatientService } from '../../../../core/services/patient.service';
import { ToasterService } from '../../../../core/services/toaster.service';

@Component({
  selector: 'app-patient-detail',
  imports: [CommonModule, Page, Svg, Typography, Button, Loader, Tabs, ModalComponent, AddEditPatient],
  templateUrl: './patient-detail.html',
  styleUrl: './patient-detail.scss',
})
export class PatientDetail implements OnInit, OnDestroy {
  private destroy$ = new Subject<void>();
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private patientService = inject(PatientService);
  private toasterService = inject(ToasterService);

  protected readonly TypographyTypeEnum = TypographyTypeEnum;
  protected readonly ButtonSizeEnum = ButtonSizeEnum;
  protected readonly ButtonStyleEnum = ButtonStyleEnum;

  patientId: number | null = null;
  activeTab = signal<'overview' | 'consultations' | 'appointments'>('overview');
  showEditModal = signal(false);
  loading = signal(true);

  patient = signal<IUser | null>(null);
  healthMetrics = signal<IHealthMetric[]>([]);

  upcomingAppointments: IPatientAppointment[] = [
    {
      id: 1,
      date: '2024-01-15',
      time: '10:30',
      type: 'Follow-up Consultation',
      doctor: 'Dr. Laurent',
      status: 'confirmed',
      notes: 'Review blood test results'
    },
    {
      id: 2,
      date: '2024-01-22',
      time: '14:00',
      type: 'Routine Check-up',
      doctor: 'Dr. Laurent',
      status: 'confirmed',
      notes: 'Annual physical examination'
    },
    {
      id: 3,
      date: '2024-02-05',
      time: '11:00',
      type: 'Specialist Referral',
      doctor: 'Dr. Moreau',
      status: 'pending',
      notes: 'Cardiology consultation'
    }
  ];

  consultationHistory: IPatientConsultation[] = [
    {
      id: 1,
      date: '2024-01-10',
      time: '10:30',
      type: 'Follow-up',
      doctor: 'Dr. Laurent',
      duration: '25 min',
      diagnosis: 'Blood pressure monitoring',
      prescription: 'Continue current medication',
      notes: 'Patient doing well, BP stable. Schedule follow-up in 2 weeks.',
      status: 'completed'
    },
    {
      id: 2,
      date: '2024-01-03',
      time: '14:15',
      type: 'Initial Consultation',
      doctor: 'Dr. Laurent',
      duration: '45 min',
      diagnosis: 'Hypertension - Stage 1',
      prescription: 'Lisinopril 10mg once daily',
      notes: 'Started on medication. Advised lifestyle modifications including diet and exercise.',
      status: 'completed'
    },
    {
      id: 3,
      date: '2023-12-20',
      time: '09:00',
      type: 'Annual Check-up',
      doctor: 'Dr. Laurent',
      duration: '30 min',
      diagnosis: 'Elevated blood pressure',
      prescription: 'Blood work ordered',
      notes: 'Blood pressure elevated. Ordered comprehensive metabolic panel and lipid panel.',
      status: 'completed'
    }
  ];

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
      healthMetrics: this.patientService.getPatientHealthMetrics(this.patientId, { page_size: 10 })
    }).pipe(
      takeUntil(this.destroy$)
    ).subscribe({
      next: ({ patient, healthMetrics }) => {
        this.patient.set(patient);
        this.healthMetrics.set(this.transformHealthMetrics(healthMetrics.results));
        this.loading.set(false);
      },
      error: () => {
        this.toasterService.show('error', 'Error', 'Failed to load patient');
        this.loading.set(false);
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

  formatDate(dateString: string): string {
    return new Date(dateString).toLocaleDateString('en-US', {
      day: 'numeric',
      month: 'short',
      year: 'numeric'
    });
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
