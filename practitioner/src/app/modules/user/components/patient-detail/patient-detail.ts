import { Component, OnInit, OnDestroy, signal, inject } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { CommonModule } from '@angular/common';
import { Subject, takeUntil } from 'rxjs';
import { Page } from '../../../../core/components/page/page';
import { Svg } from '../../../../shared/ui-components/svg/svg';
import { Typography } from '../../../../shared/ui-components/typography/typography';
import { Button } from '../../../../shared/ui-components/button/button';
import { Tabs, TabItem } from '../../../../shared/components/tabs/tabs';
import { ModalComponent } from '../../../../shared/components/modal/modal.component';
import { AddEditPatient, IPatientFormData } from '../add-edit-patient/add-edit-patient';
import { TypographyTypeEnum } from '../../../../shared/constants/typography';
import { ButtonSizeEnum, ButtonStyleEnum } from '../../../../shared/constants/button';
import { IPatient, IHealthMetric, IPatientAppointment, IPatientConsultation } from '../../models/patient';
import { RoutePaths } from '../../../../core/constants/routes';

@Component({
  selector: 'app-patient-detail',
  imports: [CommonModule, Page, Svg, Typography, Button, Tabs, ModalComponent, AddEditPatient],
  templateUrl: './patient-detail.html',
  styleUrl: './patient-detail.scss',
})
export class PatientDetail implements OnInit, OnDestroy {
  private destroy$ = new Subject<void>();
  private route = inject(ActivatedRoute);
  private router = inject(Router);

  protected readonly TypographyTypeEnum = TypographyTypeEnum;
  protected readonly ButtonSizeEnum = ButtonSizeEnum;
  protected readonly ButtonStyleEnum = ButtonStyleEnum;

  patientId: number | null = null;
  activeTab = signal<'overview' | 'consultations' | 'appointments'>('overview');
  showEditModal = signal(false);

  patient: IPatient | null = null;

  healthMetrics: IHealthMetric[] = [
    {
      id: 1,
      name: 'Heart Rate',
      value: '72',
      unit: 'bpm',
      icon: 'heart',
      color: 'rose',
      trend: 'stable',
      lastUpdated: '2024-01-12',
    },
    {
      id: 2,
      name: 'Blood Pressure',
      value: '120/80',
      unit: 'mmHg',
      icon: 'activity',
      color: 'purple',
      trend: 'down',
      lastUpdated: '2024-01-12',
    },
    {
      id: 3,
      name: 'Temperature',
      value: '36.8',
      unit: 'C',
      icon: 'thermometer',
      color: 'amber',
      trend: 'stable',
      lastUpdated: '2024-01-10',
    },
    {
      id: 4,
      name: 'Weight',
      value: '72.5',
      unit: 'kg',
      icon: 'weight',
      color: 'blue',
      trend: 'up',
      lastUpdated: '2024-01-08',
    }
  ];

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

  patients: IPatient[] = [
    {
      id: 1,
      name: 'Marie Dupont',
      avatar: 'MD',
      email: 'marie.dupont@email.com',
      phone: '+33 6 12 34 56 78',
      dateOfBirth: '1985-03-15',
      lastVisit: '2024-01-10',
      totalConsultations: 12,
      status: 'active'
    },
    {
      id: 2,
      name: 'Jean Martin',
      avatar: 'JM',
      email: 'jean.martin@email.com',
      phone: '+33 6 98 76 54 32',
      dateOfBirth: '1978-07-22',
      lastVisit: '2024-01-08',
      totalConsultations: 8,
      status: 'active'
    },
    {
      id: 3,
      name: 'Sophie Bernard',
      avatar: 'SB',
      email: 'sophie.b@email.com',
      phone: '+33 6 55 44 33 22',
      dateOfBirth: '1992-11-30',
      lastVisit: '2023-12-20',
      totalConsultations: 5,
      status: 'inactive'
    },
    {
      id: 4,
      name: 'Pierre Durand',
      avatar: 'PD',
      email: 'p.durand@email.com',
      phone: '+33 6 11 22 33 44',
      dateOfBirth: '1965-05-08',
      lastVisit: '2024-01-12',
      totalConsultations: 24,
      status: 'active'
    },
    {
      id: 5,
      name: 'Claire Moreau',
      avatar: 'CM',
      email: 'c.moreau@email.com',
      phone: '+33 6 77 88 99 00',
      dateOfBirth: '1988-09-25',
      lastVisit: '2024-01-05',
      totalConsultations: 15,
      status: 'active'
    },
    {
      id: 6,
      name: 'Lucas Petit',
      avatar: 'LP',
      email: 'lucas.petit@email.com',
      phone: '+33 6 44 55 66 77',
      dateOfBirth: '1995-02-14',
      lastVisit: '2023-11-15',
      totalConsultations: 3,
      status: 'inactive'
    },
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
    this.patient = this.patients.find(p => p.id === this.patientId) || null;
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

  onPatientSaved(formData: IPatientFormData): void {
    if (this.patient) {
      this.patient = {
        ...this.patient,
        name: formData.name,
        email: formData.email,
        phone: formData.phone,
        dateOfBirth: formData.dateOfBirth,
        avatar: this.getInitials(formData.name)
      };
      this.closeEditModal();
    }
  }

  private getInitials(name: string): string {
    return name
      .split(' ')
      .map(n => n[0])
      .join('')
      .toUpperCase()
      .slice(0, 2);
  }

  calculateAge(dateOfBirth: string): number {
    const today = new Date();
    const birthDate = new Date(dateOfBirth);
    let age = today.getFullYear() - birthDate.getFullYear();
    const monthDiff = today.getMonth() - birthDate.getMonth();
    if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birthDate.getDate())) {
      age--;
    }
    return age;
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
