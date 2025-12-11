import { Component, signal } from '@angular/core';
import { Router } from '@angular/router';
import { CommonModule } from '@angular/common';
import { Page } from '../../../../core/components/page/page';
import { Svg } from '../../../../shared/ui-components/svg/svg';
import { Typography } from '../../../../shared/ui-components/typography/typography';
import { TypographyTypeEnum } from '../../../../shared/constants/typography';
import { IPatient } from '../../models/patient';
import { RoutePaths } from '../../../../core/constants/routes';

@Component({
  selector: 'app-patients',
  imports: [CommonModule, Page, Svg, Typography],
  templateUrl: './patients.html',
  styleUrl: './patients.scss',
})
export class Patients {
  protected readonly TypographyTypeEnum = TypographyTypeEnum;

  loading = signal(false);

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

  constructor(private router: Router) {}

  get totalPatients(): number {
    return this.patients.length;
  }

  get activePatients(): number {
    return this.patients.filter(p => p.status === 'active').length;
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

  viewPatient(patient: IPatient): void {
    this.router.navigate([RoutePaths.USER, 'patients', patient.id]);
  }

  addPatient(): void {
    this.router.navigate([RoutePaths.USER, 'patients', 'new']);
  }
}
