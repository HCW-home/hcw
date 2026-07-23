import {
  Input,
  inject,
  signal,
  Output,
  OnInit,
  OnDestroy,
  Component,
  EventEmitter,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import {
  FormGroup,
  FormsModule,
  Validators,
  FormBuilder,
  ReactiveFormsModule,
} from '@angular/forms';
import { Subject, takeUntil } from 'rxjs';

import { Auth } from '../../../core/services/auth';
import { UserService } from '../../../core/services/user.service';
import { ITemporaryParticipant } from '../../../core/models/consultation';
import { IUser } from '../../../modules/user/models/user';

import { Svg } from '../../ui-components/svg/svg';
import { Input as InputComponent } from '../../ui-components/input/input';
import { Select } from '../../ui-components/select/select';
import { Checkbox } from '../../ui-components/checkbox/checkbox';
import { SelectOption } from '../../models/select';
import { TIMEZONE_OPTIONS } from '../../constants/timezone';
import { TranslatePipe } from '@ngx-translate/core';
import { TranslationService } from '../../../core/services/translation.service';

/**
 * Reusable "external contact" entry form. Mirrors the external-guest form used
 * in the appointment participant modal: the practitioner picks a contact
 * method (email / SMS / manual), fills in the contact details, and the
 * component builds an ``ITemporaryParticipant`` payload. On the backend that
 * payload is mapped to an existing user (by email/phone) or creates a
 * temporary user.
 *
 * Parents drive validation imperatively on submit: call ``markAllTouched()``
 * then ``isValid()``, and read ``buildPayload()``.
 */
@Component({
  selector: 'app-external-contact-form',
  templateUrl: './external-contact-form.html',
  styleUrl: './external-contact-form.scss',
  imports: [
    Svg,
    Select,
    Checkbox,
    CommonModule,
    InputComponent,
    ReactiveFormsModule,
    FormsModule,
    TranslatePipe,
  ],
})
export class ExternalContactForm implements OnInit, OnDestroy {
  // Show the "visible in consultation" checkbox (only relevant for
  // appointment participants, not for a beneficiary or reminder recipient).
  @Input() showVisibility = false;
  // Backend field errors keyed by contact field name (email/mobile_phone_number).
  @Input() set backendErrors(errors: Record<string, string[]>) {
    this._backendErrors.set(errors || {});
  }

  @Output() contactChange = new EventEmitter<ITemporaryParticipant | null>();

  private destroy$ = new Subject<void>();
  private fb = inject(FormBuilder);
  private authService = inject(Auth);
  private userService = inject(UserService);
  private t = inject(TranslationService);

  currentUser = signal<IUser | null>(null);
  availableCommunicationMethods = signal<string[]>([]);
  contactForm!: FormGroup;
  private _backendErrors = signal<Record<string, string[]>>({});

  timezoneOptions: SelectOption[] = TIMEZONE_OPTIONS;

  get hasEmailMethod(): boolean {
    return this.availableCommunicationMethods().includes('email');
  }

  get hasPhoneMethod(): boolean {
    const methods = this.availableCommunicationMethods();
    return methods.includes('sms') || methods.includes('whatsapp');
  }

  get communicationMethods(): SelectOption[] {
    const methods = this.availableCommunicationMethods();
    const options: SelectOption[] = [];
    if (methods.includes('sms')) {
      options.push({ value: 'sms', label: this.t.instant('appointmentForm.sms') });
    }
    if (methods.includes('whatsapp')) {
      options.push({
        value: 'whatsapp',
        label: this.t.instant('appointmentForm.whatsApp'),
      });
    }
    return options;
  }

  get hasMultipleCommunicationMethods(): boolean {
    return this.communicationMethods.length > 1;
  }

  get shouldShowCommunicationMethodField(): boolean {
    const contactType = this.contactForm?.get('contact_type')?.value;
    return contactType === 'sms' && this.communicationMethods.length > 0;
  }

  get defaultContactType(): string {
    if (this.hasEmailMethod) {
      return 'email';
    } else if (this.hasPhoneMethod) {
      return 'sms';
    }
    return 'manual';
  }

  get languageOptions(): SelectOption[] {
    return [
      { value: 'en', label: this.t.instant('appointmentForm.english') },
      { value: 'de', label: this.t.instant('appointmentForm.german') },
      { value: 'fr', label: this.t.instant('appointmentForm.french') },
    ];
  }

  ngOnInit(): void {
    this.initForm();
    this.loadCurrentUser();
    this.loadConfig();

    this.contactForm.valueChanges
      .pipe(takeUntil(this.destroy$))
      .subscribe(() => {
        if (Object.keys(this._backendErrors()).length > 0) {
          this._backendErrors.set({});
        }
        this.contactChange.emit(
          this.contactForm.valid ? this.buildPayload() : null
        );
      });
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  private loadCurrentUser(): void {
    this.userService.currentUser$
      .pipe(takeUntil(this.destroy$))
      .subscribe(user => {
        this.currentUser.set(user);
        if (user && !this.contactForm.get('timezone')?.value) {
          this.contactForm.patchValue(
            {
              timezone: user.timezone || '',
              communication_method: user.communication_method || '',
              preferred_language: user.preferred_language || '',
            },
            { emitEvent: false }
          );
        }
      });
    if (!this.currentUser()) {
      this.userService
        .getCurrentUser()
        .pipe(takeUntil(this.destroy$))
        .subscribe();
    }
  }

  private loadConfig(): void {
    this.authService
      .getOpenIDConfig()
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: config => {
          this.availableCommunicationMethods.set(
            config.communication_methods || []
          );
          this.contactForm.patchValue(
            { contact_type: this.defaultContactType },
            { emitEvent: false }
          );
          this.updateValidators(this.defaultContactType);
        },
      });
  }

  private initForm(): void {
    const currentUserData = this.currentUser();
    this.contactForm = this.fb.group({
      first_name: [''],
      last_name: [''],
      email: [''],
      phone: [''],
      contact_type: ['email', [Validators.required]],
      timezone: [currentUserData?.timezone || ''],
      communication_method: [currentUserData?.communication_method || ''],
      preferred_language: [currentUserData?.preferred_language || ''],
      is_consultation_visible: [true],
    });

    this.contactForm
      .get('contact_type')
      ?.valueChanges.pipe(takeUntil(this.destroy$))
      .subscribe(contactType => this.updateValidators(contactType));
  }

  private updateValidators(contactType: string): void {
    const emailControl = this.contactForm.get('email');
    const phoneControl = this.contactForm.get('phone');
    const communicationMethodControl = this.contactForm.get(
      'communication_method'
    );

    emailControl?.clearValidators();
    phoneControl?.clearValidators();
    communicationMethodControl?.clearValidators();

    emailControl?.markAsUntouched();
    phoneControl?.markAsUntouched();
    communicationMethodControl?.markAsUntouched();

    if (contactType === 'email') {
      emailControl?.setValidators([Validators.required, Validators.email]);
    } else if (contactType === 'sms') {
      phoneControl?.setValidators([Validators.required]);
      if (this.hasMultipleCommunicationMethods) {
        communicationMethodControl?.setValidators([Validators.required]);
        communicationMethodControl?.enable({ emitEvent: false });
      } else {
        communicationMethodControl?.disable({ emitEvent: false });
      }
    }

    emailControl?.updateValueAndValidity({ emitEvent: false });
    phoneControl?.updateValueAndValidity({ emitEvent: false });
    communicationMethodControl?.updateValueAndValidity({ emitEvent: false });
  }

  setContactType(type: string): void {
    let communicationMethod = '';
    if (type === 'email') {
      communicationMethod = 'email';
    } else if (type === 'manual') {
      communicationMethod = 'manual';
    } else if (type === 'sms') {
      const methods = this.communicationMethods;
      if (methods.length === 1) {
        communicationMethod = String(methods[0].value);
      }
    }
    this.contactForm.patchValue({
      contact_type: type,
      communication_method: communicationMethod,
    });
  }

  getFieldError(fieldName: string): string {
    // The backend reports contact errors on email / mobile_phone_number.
    const backendKey = fieldName === 'phone' ? 'mobile_phone_number' : fieldName;
    const errors = this._backendErrors();
    if (errors[backendKey] && errors[backendKey].length > 0) {
      return errors[backendKey][0];
    }
    const control = this.contactForm.get(fieldName);
    if (control && control.invalid && control.touched) {
      if (control.hasError('required')) {
        return this.t.instant('appointmentForm.fieldRequired');
      }
      if (control.hasError('email')) {
        return this.t.instant('appointmentForm.invalidEmail');
      }
    }
    return '';
  }

  markAllTouched(): void {
    Object.keys(this.contactForm.controls).forEach(key => {
      this.contactForm.get(key)?.markAsTouched();
    });
  }

  isValid(): boolean {
    return this.contactForm.valid;
  }

  reset(): void {
    const currentUserData = this.currentUser();
    this.contactForm.reset({
      contact_type: this.defaultContactType,
      timezone: currentUserData?.timezone || '',
      communication_method: currentUserData?.communication_method || '',
      preferred_language: currentUserData?.preferred_language || '',
      is_consultation_visible: true,
    });
    this._backendErrors.set({});
  }

  buildPayload(): ITemporaryParticipant | null {
    const formValue = this.contactForm.getRawValue();
    const data: ITemporaryParticipant = {};

    if (formValue.first_name) {
      data.first_name = formValue.first_name;
    }
    if (formValue.last_name) {
      data.last_name = formValue.last_name;
    }
    if (formValue.timezone) {
      data.timezone = formValue.timezone;
    }
    if (formValue.preferred_language) {
      data.preferred_language = formValue.preferred_language;
    }

    let communicationMethod = formValue.communication_method;
    if (formValue.contact_type === 'email') {
      communicationMethod = 'email';
      data.email = formValue.email;
    } else if (formValue.contact_type === 'sms') {
      data.mobile_phone_number = formValue.phone;
      if (!communicationMethod) {
        const methods = this.communicationMethods;
        communicationMethod =
          methods.length > 0 ? String(methods[0].value) : 'sms';
      }
    } else if (formValue.contact_type === 'manual') {
      communicationMethod = 'manual';
    }

    if (communicationMethod) {
      data.communication_method = communicationMethod;
    }

    if (this.showVisibility) {
      data.is_consultation_visible = !!formValue.is_consultation_visible;
    }

    // A contact needs at least an email, a phone, or a name (manual).
    if (!data.email && !data.mobile_phone_number && !data.first_name && !data.last_name) {
      return null;
    }
    return data;
  }
}
