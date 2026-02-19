import { Component, input, output, inject, OnInit, OnDestroy, effect } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ReactiveFormsModule, FormBuilder, FormGroup, Validators } from '@angular/forms';
import { Subject, takeUntil } from 'rxjs';
import { Typography } from '../../../../shared/ui-components/typography/typography';
import { Button } from '../../../../shared/ui-components/button/button';
import { Input } from '../../../../shared/ui-components/input/input';
import { Select } from '../../../../shared/ui-components/select/select';
import { TypographyTypeEnum } from '../../../../shared/constants/typography';
import { ButtonSizeEnum, ButtonStyleEnum } from '../../../../shared/constants/button';
import { PatientService, IPatientCreateRequest, IPatientUpdateRequest } from '../../../../core/services/patient.service';
import { UserService } from '../../../../core/services/user.service';
import { Auth } from '../../../../core/services/auth';
import { IOpenIDConfig } from '../../../../core/models/admin-auth';
import { ToasterService } from '../../../../core/services/toaster.service';
import { IUser, ILanguage } from '../../models/user';
import { SelectOption } from '../../../../shared/models/select';
import { getErrorMessage } from '../../../../core/utils/error-helper';
import { TranslatePipe } from '@ngx-translate/core';
import { TranslationService } from '../../../../core/services/translation.service';

@Component({
  selector: 'app-add-edit-patient',
  imports: [CommonModule, ReactiveFormsModule, Typography, Button, Input, Select, TranslatePipe],
  templateUrl: './add-edit-patient.html',
  styleUrl: './add-edit-patient.scss',
})
export class AddEditPatient implements OnInit, OnDestroy {
  private destroy$ = new Subject<void>();
  private fb = inject(FormBuilder);
  private patientService = inject(PatientService);
  private userService = inject(UserService);
  private authService = inject(Auth);
  private toasterService = inject(ToasterService);
  private t = inject(TranslationService);

  patient = input<IUser | null>(null);

  saved = output<void>();
  cancelled = output<void>();

  constructor() {
    effect(() => {
      const patient = this.patient();
      if (this.form) {
        this.reinitializeForm(patient);
      }
    });
  }

  protected readonly TypographyTypeEnum = TypographyTypeEnum;
  protected readonly ButtonSizeEnum = ButtonSizeEnum;
  protected readonly ButtonStyleEnum = ButtonStyleEnum;

  form!: FormGroup;
  loading = false;
  languageOptions: SelectOption[] = [];

  get isEditMode(): boolean {
    return !!this.patient();
  }

  ngOnInit(): void {
    this.initForm();
    this.loadLanguages();
  }

  private loadLanguages(): void {
    this.authService.getOpenIDConfig().pipe(
      takeUntil(this.destroy$)
    ).subscribe({
      next: (config: IOpenIDConfig) => {
        this.languageOptions = (config.languages || []).map((lang: { code: string; name: string }) => ({
          value: lang.code,
          label: lang.name
        }));
      }
    });
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  private initForm(): void {
    const p = this.patient();
    this.form = this.fb.group({
      first_name: [p?.first_name || ''],
      last_name: [p?.last_name || ''],
      email: [p?.email || '', [Validators.email]],
      mobile_phone_number: [p?.mobile_phone_number || ''],
      timezone: [p?.timezone || 'UTC'],
      preferred_language: [p?.preferred_language || null]
    });

    if (this.isEditMode) {
      this.form.get('email')?.disable();
    }
  }

  private reinitializeForm(p: IUser | null): void {
    this.form.patchValue({
      first_name: p?.first_name || '',
      last_name: p?.last_name || '',
      email: p?.email || '',
      mobile_phone_number: p?.mobile_phone_number || '',
      timezone: p?.timezone || 'UTC',
      preferred_language: p?.preferred_language || null
    });

    if (p) {
      this.form.get('email')?.disable();
    } else {
      this.form.get('email')?.enable();
    }
  }

  getInitials(): string {
    const firstName = this.form.get('first_name')?.value || '';
    const lastName = this.form.get('last_name')?.value || '';
    const first = firstName.charAt(0) || '';
    const last = lastName.charAt(0) || '';
    return (first + last).toUpperCase() || 'N';
  }

  onSave(): void {
    if (this.form.invalid) {
      Object.keys(this.form.controls).forEach(key => {
        this.form.get(key)?.markAsTouched();
      });
      return;
    }

    this.loading = true;
    const formValue = this.form.getRawValue();

    if (this.isEditMode) {
      const updateData: IPatientUpdateRequest = {
        first_name: formValue.first_name,
        last_name: formValue.last_name,
        mobile_phone_number: formValue.mobile_phone_number,
        timezone: formValue.timezone,
        preferred_language: formValue.preferred_language
      };

      this.patientService.updatePatient(this.patient()!.pk, updateData).pipe(
        takeUntil(this.destroy$)
      ).subscribe({
        next: () => {
          this.toasterService.show('success', this.t.instant('addEditPatient.patientUpdated'), this.t.instant('addEditPatient.patientUpdatedMessage'));
          this.loading = false;
          this.saved.emit();
        },
        error: (error) => {
          this.toasterService.show('error', this.t.instant('addEditPatient.errorUpdating'), getErrorMessage(error));
          this.loading = false;
        }
      });
    } else {
      const createData: IPatientCreateRequest = {
        first_name: formValue.first_name,
        last_name: formValue.last_name,
        email: formValue.email,
        mobile_phone_number: formValue.mobile_phone_number,
        timezone: formValue.timezone,
        preferred_language: formValue.preferred_language,
        language_ids: []
      };

      this.patientService.createPatient(createData).pipe(
        takeUntil(this.destroy$)
      ).subscribe({
        next: () => {
          this.toasterService.show('success', this.t.instant('addEditPatient.patientCreated'), this.t.instant('addEditPatient.patientCreatedMessage'));
          this.loading = false;
          this.saved.emit();
        },
        error: (error) => {
          this.toasterService.show('error', this.t.instant('addEditPatient.errorCreating'), getErrorMessage(error));
          this.loading = false;
        }
      });
    }
  }

  onCancel(): void {
    this.cancelled.emit();
  }

  isFieldInvalid(fieldName: string): boolean {
    const field = this.form.get(fieldName);
    return !!(field && field.invalid && field.touched);
  }

  getFieldError(fieldName: string): string {
    const field = this.form.get(fieldName);
    if (field?.errors?.['required']) {
      return this.t.instant('addEditPatient.fieldRequired');
    }
    if (field?.errors?.['email']) {
      return this.t.instant('addEditPatient.invalidEmail');
    }
    return '';
  }
}
