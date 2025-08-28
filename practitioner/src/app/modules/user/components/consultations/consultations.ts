import { Component, OnInit, signal } from '@angular/core';
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

@Component({
  selector: 'app-consultations',
  imports: [Page, Button, Typography, Tabs, ConsultationCard, Svg],
  templateUrl: './consultations.html',
  styleUrl: './consultations.scss',
})
export class Consultations implements OnInit {
  breadcrumbs = [{ label: 'Consultations' }];

  activeTab = signal<'active' | 'past'>('active');
  consultations = signal<IConsultation[]>([]);

  protected readonly ButtonSizeEnum = ButtonSizeEnum;
  protected readonly ButtonStyleEnum = ButtonStyleEnum;
  protected readonly TypographyTypeEnum = TypographyTypeEnum;

  ngOnInit() {
    this.loadMockData();
  }

  get activeConsultations(): IConsultation[] {
    return this.consultations().filter(
      c => c.status === 'scheduled' || c.status === 'active'
    );
  }

  get pastConsultations(): IConsultation[] {
    return this.consultations().filter(
      c => c.status === 'completed' || c.status === 'cancelled'
    );
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
    console.log('Viewing consultation:', consultation.id);
  }

  scheduleFollowUp(consultation: IConsultation) {
    console.log('Scheduling follow-up for:', consultation.id);
  }

  private loadMockData() {
    const mockConsultations: IConsultation[] = [
      {
        id: '1',
        patient_name: 'Sarah Johnson',
        consultation_type: 'video',
        date: new Date('2024-12-27T14:30:00'),
        duration: 30,
        status: 'scheduled',
        patient_age: 34,
        symptoms: ['Headache', 'Fever'],
        follow_up_required: false,
        patient_email: 'sarah.j@email.com',
      },
      {
        id: '2',
        patient_name: 'Michael Chen',
        consultation_type: 'audio',
        date: new Date('2024-12-27T16:00:00'),
        duration: 20,
        status: 'active',
        patient_age: 28,
        symptoms: ['Cough', 'Sore throat'],
        follow_up_required: true,
        patient_phone: '+1234567890',
      },
      {
        id: '3',
        patient_name: 'Emily Davis',
        consultation_type: 'video',
        date: new Date('2024-12-26T10:00:00'),
        duration: 45,
        status: 'completed',
        patient_age: 42,
        symptoms: ['Back pain', 'Muscle stiffness'],
        follow_up_required: true,
        prescription: 'Prescribed muscle relaxants and physical therapy',
        notes: 'Patient responding well to treatment',
      },
      {
        id: '4',
        patient_name: 'David Wilson',
        consultation_type: 'chat',
        date: new Date('2024-12-25T09:30:00'),
        duration: 15,
        status: 'completed',
        patient_age: 55,
        symptoms: ['Skin rash', 'Itching'],
        follow_up_required: false,
        prescription: 'Topical cream recommended',
        notes: 'Minor allergic reaction, resolved',
      },
    ];

    this.consultations.set(mockConsultations);
  }
}
