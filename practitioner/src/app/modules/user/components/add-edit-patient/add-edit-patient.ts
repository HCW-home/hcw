import { Component, input, output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Typography } from '../../../../shared/ui-components/typography/typography';
import { Button } from '../../../../shared/ui-components/button/button';
import { Input } from '../../../../shared/ui-components/input/input';
import { TypographyTypeEnum } from '../../../../shared/constants/typography';
import { ButtonSizeEnum, ButtonStyleEnum } from '../../../../shared/constants/button';
import { IPatient } from '../../models/patient';

export interface IPatientFormData {
  name: string;
  email: string;
  phone: string;
  dateOfBirth: string;
}

@Component({
  selector: 'app-add-edit-patient',
  imports: [CommonModule, FormsModule, Typography, Button, Input],
  templateUrl: './add-edit-patient.html',
  styleUrl: './add-edit-patient.scss',
})
export class AddEditPatient {
  patient = input<IPatient | null>(null);

  saved = output<IPatientFormData>();
  cancelled = output<void>();

  protected readonly TypographyTypeEnum = TypographyTypeEnum;
  protected readonly ButtonSizeEnum = ButtonSizeEnum;
  protected readonly ButtonStyleEnum = ButtonStyleEnum;

  formData: IPatientFormData = {
    name: '',
    email: '',
    phone: '',
    dateOfBirth: ''
  };

  ngOnInit(): void {
    const p = this.patient();
    if (p) {
      this.formData = {
        name: p.name,
        email: p.email,
        phone: p.phone,
        dateOfBirth: p.dateOfBirth
      };
    }
  }

  onSave(): void {
    this.saved.emit(this.formData);
  }

  onCancel(): void {
    this.cancelled.emit();
  }

  calculateAge(dateOfBirth: string): number {
    if (!dateOfBirth) return 0;
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
    if (!dateString) return '';
    return new Date(dateString).toLocaleDateString('en-US', {
      day: 'numeric',
      month: 'short',
      year: 'numeric'
    });
  }
}
