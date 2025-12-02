import { Component, Input, Output, EventEmitter, inject } from '@angular/core';
import { FormGroup, ReactiveFormsModule } from '@angular/forms';
import { CommonModule } from '@angular/common';

import { Typography } from '../../../../shared/ui-components/typography/typography';
import { Button } from '../../../../shared/ui-components/button/button';
import { Input as InputComponent } from '../../../../shared/ui-components/input/input';
import { Switch } from '../../../../shared/ui-components/switch/switch';
import { ValidationService } from '../../../../core/services/validation.service';

import { TypographyTypeEnum } from '../../../../shared/constants/typography';
import { ButtonSizeEnum, ButtonStyleEnum } from '../../../../shared/constants/button';

interface WeekDay {
  key: string;
  label: string;
  short: string;
}

@Component({
  selector: 'app-slot-modal',
  imports: [
    CommonModule,
    ReactiveFormsModule,
    Typography,
    Button,
    InputComponent,
    Switch
  ],
  templateUrl: './slot-modal.html',
  styleUrl: './slot-modal.scss'
})
export class SlotModal {
  @Input() modalTitle = '';
  @Input() modalMode: 'create' | 'edit' = 'create';
  @Input() slotForm!: FormGroup;
  @Input() weekDays: WeekDay[] = [];
  @Input() isSaving = false;

  @Output() closeModal = new EventEmitter<void>();
  @Output() save = new EventEmitter<void>();

  private validationService = inject(ValidationService);

  protected readonly TypographyTypeEnum = TypographyTypeEnum;
  protected readonly ButtonSizeEnum = ButtonSizeEnum;
  protected readonly ButtonStyleEnum = ButtonStyleEnum;

  onCloseModal(): void {
    this.closeModal.emit();
  }

  saveSlot(): void {
    this.save.emit();
  }

  isFieldInvalid(form: FormGroup, fieldName: string): boolean {
    return this.validationService.showError(form, fieldName);
  }

  getFieldError(form: FormGroup, fieldName: string): string {
    const field = form.get(fieldName);
    if (field?.errors && field?.touched) {
      if (field.errors['required']) return `${fieldName} is required`;
      if (field.errors['minlength']) return `${fieldName} is too short`;
      if (field.errors['maxlength']) return `${fieldName} is too long`;
    }
    return '';
  }
}
