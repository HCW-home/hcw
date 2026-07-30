import {
  Component,
  EventEmitter,
  Input,
  OnDestroy,
  OnInit,
  Output,
  inject,
  signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import {
  FormBuilder,
  FormGroup,
  ReactiveFormsModule,
  Validators,
} from '@angular/forms';
import { Subject, takeUntil } from 'rxjs';
import { TranslatePipe } from '@ngx-translate/core';

import { Auth } from '../../../core/services/auth';
import { TranslationService } from '../../../core/services/translation.service';
import { CreateParticipantRequest } from '../../../core/models/consultation';
import { IUser } from '../../../modules/user/models/user';

import { Button } from '../../ui-components/button/button';
import { Checkbox } from '../../ui-components/checkbox/checkbox';
import { Input as InputComponent } from '../../ui-components/input/input';
import { Select } from '../../ui-components/select/select';
import { Svg } from '../../ui-components/svg/svg';
import { ModalComponent } from '../modal/modal.component';
import { UserSelectOrCreate } from '../user-select-or-create/user-select-or-create';
import { ButtonSizeEnum, ButtonStyleEnum } from '../../constants/button';
import { SelectOption } from '../../models/select';
import { TIMEZONE_OPTIONS } from '../../constants/timezone';

/**
 * Modal used to describe a participant to add, either an existing user or an
 * external guest reachable by email, SMS or a manual invitation link.
 *
 * The component only builds the payload and emits it: persisting it is left to
 * the host, which either queues it locally (appointment creation/edition) or
 * posts it right away (adding someone to a running call).
 */
@Component({
  selector: 'app-participant-add-form',
  templateUrl: './participant-add-form.html',
  styleUrl: './participant-add-form.scss',
  imports: [
    Svg,
    Select,
    Button,
    Checkbox,
    CommonModule,
    InputComponent,
    ModalComponent,
    UserSelectOrCreate,
    ReactiveFormsModule,
    TranslatePipe,
  ],
})
export class ParticipantAddForm implements OnInit, OnDestroy {
  @Input() isOpen = false;
  @Input() currentUser: IUser | null = null;
  @Input() isSubmitting = false;
  @Input() disableSubmit = false;
  @Input() highlightExternalGuest = false;
  @Input() highlightExternalEmail = false;
  @Input() highlightVisibleCheckbox = false;
  @Input() highlightSubmit = false;

  @Output() added = new EventEmitter<CreateParticipantRequest>();
  @Output() closed = new EventEmitter<void>();
  @Output() externalGuestSelected = new EventEmitter<void>();

  private destroy$ = new Subject<void>();
  private fb = inject(FormBuilder);
  private authService = inject(Auth);
  private t = inject(TranslationService);

  participantForm!: FormGroup;
  isExistingUser = signal(true);
  selectedParticipantUser = signal<IUser | null>(null);
  availableCommunicationMethods = signal<string[]>([]);

  timezoneOptions: SelectOption[] = TIMEZONE_OPTIONS;

  protected readonly ButtonStyleEnum = ButtonStyleEnum;
  protected readonly ButtonSizeEnum = ButtonSizeEnum;

  ngOnInit(): void {
    this.initParticipantForm();
    this.loadConfig();
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

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
      options.push({
        value: 'sms',
        label: this.t.instant('appointmentForm.sms'),
      });
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
    const contactType = this.participantForm?.get('contact_type')?.value;
    return contactType === 'sms' && this.communicationMethods.length > 0;
  }

  get defaultContactType(): string {
    if (this.hasEmailMethod) {
      return 'email';
    } else if (this.hasPhoneMethod) {
      return 'sms';
    } else {
      return 'manual';
    }
  }

  get languageOptions(): SelectOption[] {
    return [
      { value: 'en', label: this.t.instant('appointmentForm.english') },
      { value: 'de', label: this.t.instant('appointmentForm.german') },
      { value: 'fr', label: this.t.instant('appointmentForm.french') },
    ];
  }

  private initParticipantForm(): void {
    this.participantForm = this.fb.group({
      user_id: [null],
      first_name: [''],
      last_name: [''],
      email: [''],
      phone: [''],
      contact_type: ['email', [Validators.required]],
      timezone: [this.currentUser?.timezone || ''],
      communication_method: [this.currentUser?.communication_method || ''],
      preferred_language: [this.currentUser?.preferred_language || ''],
      // Checked by default: new participants can see the follow-up messages.
      is_consultation_visible: [true],
    });

    // Update validators when contact_type changes
    this.participantForm
      .get('contact_type')
      ?.valueChanges.pipe(takeUntil(this.destroy$))
      .subscribe(contactType => {
        this.updateParticipantValidators(contactType);
      });
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
          // Set default contact_type based on available methods
          this.participantForm.patchValue({
            contact_type: this.defaultContactType,
          });
        },
      });
  }

  private updateParticipantValidators(contactType: string): void {
    const emailControl = this.participantForm.get('email');
    const phoneControl = this.participantForm.get('phone');
    const communicationMethodControl = this.participantForm.get(
      'communication_method'
    );

    // Reset validators
    emailControl?.clearValidators();
    phoneControl?.clearValidators();
    communicationMethodControl?.clearValidators();

    // Reset touched state to prevent red flash
    emailControl?.markAsUntouched();
    phoneControl?.markAsUntouched();
    communicationMethodControl?.markAsUntouched();

    // Apply validators based on contact type
    if (contactType === 'email') {
      emailControl?.setValidators([Validators.required, Validators.email]);
    } else if (contactType === 'sms') {
      phoneControl?.setValidators([Validators.required]);
      if (this.hasMultipleCommunicationMethods) {
        communicationMethodControl?.setValidators([Validators.required]);
        communicationMethodControl?.enable();
      } else {
        // Disable if only one method available
        communicationMethodControl?.disable();
      }
    }

    // Update validity without emitting events
    emailControl?.updateValueAndValidity({ emitEvent: false });
    phoneControl?.updateValueAndValidity({ emitEvent: false });
    communicationMethodControl?.updateValueAndValidity({ emitEvent: false });
  }

  getParticipantFieldError(fieldName: string): string {
    const control = this.participantForm.get(fieldName);
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

  setParticipantType(isExisting: boolean): void {
    this.isExistingUser.set(isExisting);
    if (!isExisting) {
      this.externalGuestSelected.emit();
    }
    this.selectedParticipantUser.set(null);
    this.participantForm.reset({
      contact_type: this.defaultContactType,
      timezone: this.currentUser?.timezone || '',
      communication_method: this.currentUser?.communication_method || '',
      preferred_language: this.currentUser?.preferred_language || '',
      user_id: null,
      // Keep the follow-up visibility checked by default for guests too.
      is_consultation_visible: true,
    });
  }

  setParticipantMessageType(type: string): void {
    let communicationMethod = '';

    if (type === 'email') {
      communicationMethod = 'email';
    } else if (type === 'manual') {
      communicationMethod = 'manual';
    } else if (type === 'sms') {
      // Auto-select communication method if only one is available
      const methods = this.communicationMethods;
      if (methods.length === 1) {
        communicationMethod = String(methods[0].value);
      }
    }

    this.participantForm.patchValue({
      contact_type: type,
      communication_method: communicationMethod,
    });
  }

  onParticipantUserSelected(user: IUser | null): void {
    this.selectedParticipantUser.set(user);
    if (user) {
      this.participantForm.patchValue({ is_consultation_visible: true });
    }
  }

  confirmExistingParticipant(): void {
    const user = this.selectedParticipantUser();
    if (!user) return;
    this.added.emit({
      user_id: user.pk,
      first_name: user.first_name,
      last_name: user.last_name,
      email: user.email,
      is_consultation_visible:
        !!this.participantForm.get('is_consultation_visible')?.value,
    });
  }

  addParticipant(): void {
    // Mark all fields as touched to show validation errors
    Object.keys(this.participantForm.controls).forEach(key => {
      this.participantForm.get(key)?.markAsTouched();
    });

    if (this.participantForm.invalid) {
      return;
    }

    const formValue = this.participantForm.getRawValue();
    const data: CreateParticipantRequest = {};

    if (formValue.timezone) {
      data.timezone = formValue.timezone;
    }
    if (formValue.preferred_language) {
      data.preferred_language = formValue.preferred_language;
    }
    if (formValue.first_name) {
      data.first_name = formValue.first_name;
    }
    if (formValue.last_name) {
      data.last_name = formValue.last_name;
    }

    // Determine communication_method based on contact_type
    let communicationMethod = formValue.communication_method;
    if (formValue.contact_type === 'email') {
      communicationMethod = 'email';
      data.email = formValue.email;
    } else if (formValue.contact_type === 'sms') {
      data.mobile_phone_number = formValue.phone;
      // Use the selected method, or default to the first available if not set
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

    data.is_consultation_visible = !!formValue.is_consultation_visible;

    this.added.emit(data);
  }

  /** Bring the form back to its pristine state. Called by hosts after a save. */
  reset(): void {
    this.participantForm.reset({
      contact_type: this.defaultContactType,
      timezone: this.currentUser?.timezone || '',
      communication_method: this.currentUser?.communication_method || '',
      preferred_language: this.currentUser?.preferred_language || '',
      is_consultation_visible: true,
    });
    this.isExistingUser.set(true);
    this.selectedParticipantUser.set(null);
  }

  onClose(): void {
    this.reset();
    this.closed.emit();
  }
}
