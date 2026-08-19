import {
  Input,
  inject,
  signal,
  Output,
  OnInit,
  OnChanges,
  OnDestroy,
  Component,
  EventEmitter,
  SimpleChanges,
  ViewChild,
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

import { ConsultationService } from '../../../core/services/consultation.service';
import { ToasterService } from '../../../core/services/toaster.service';
import { UserService } from '../../../core/services/user.service';
import {
  User,
  Participant,
  Appointment,
  AppointmentType,
  ITemporaryParticipant,
  UpdateAppointmentRequest,
  CreateAppointmentRequest,
  CreateParticipantRequest,
} from '../../../core/models/consultation';
import { IUser } from '../../../modules/user/models/user';

import { Button } from '../../ui-components/button/button';
import { Input as InputComponent } from '../../ui-components/input/input';
import { Switch } from '../../ui-components/switch/switch';
import { Svg } from '../../ui-components/svg/svg';
import { Badge } from '../badge/badge';
import { Loader } from '../loader/loader';
import { ParticipantAddForm } from '../participant-add-form/participant-add-form';
import { ParticipantItem } from '../participant-item/participant-item';
import {
  ButtonStyleEnum,
  ButtonSizeEnum,
  ButtonStateEnum,
} from '../../constants/button';
import { BadgeTypeEnum, BadgeSizeEnum } from '../../constants/badge';
import { extractDateFromISO, extractTimeFromISO } from '../../tools/helper';
import { getErrorMessage } from '../../../core/utils/error-helper';
import { TranslatePipe } from '@ngx-translate/core';
import { TranslationService } from '../../../core/services/translation.service';

@Component({
  selector: 'app-appointment-form',
  templateUrl: './appointment-form.html',
  styleUrl: './appointment-form.scss',
  imports: [
    Svg,
    Loader,
    Button,
    Switch,
    CommonModule,
    InputComponent,
    ParticipantAddForm,
    Badge,
    ParticipantItem,
    ReactiveFormsModule,
    FormsModule,
    TranslatePipe,
  ],
})
export class AppointmentForm implements OnInit, OnDestroy, OnChanges {
  @Input() consultationId?: number;
  @Input() editingAppointment: Appointment | null = null;
  @Input() showActions = true;
  @Input() autoSave = true;
  @Input() beneficiary: User | null = null;
  @Input() owner: User | null = null;
  @Input() initialParticipants: CreateParticipantRequest[] = [];
  @Input() initialStartDate: Date | null = null;
  @Input() initialEndDate: Date | null = null;
  @Input() highlightAddParticipant = false;
  @Input() highlightExternalGuest = false;
  @Input() highlightExternalEmail = false;
  @Input() highlightVisibleCheckbox = false;
  @Input() highlightAddParticipantSubmit = false;
  @Input() highlightDateTime = false;
  @Input() disableAddParticipantSubmit = false;

  @Output() cancelled = new EventEmitter<void>();
  @Output() appointmentCreated = new EventEmitter<Appointment>();
  @Output() appointmentUpdated = new EventEmitter<Appointment>();
  @Output() appointmentDataReady = new EventEmitter<CreateAppointmentRequest>();
  @Output() addParticipantClicked = new EventEmitter<void>();
  @Output() externalGuestSelected = new EventEmitter<void>();
  @Output() participantAdded = new EventEmitter<void>();

  @ViewChild(ParticipantAddForm) addParticipantForm?: ParticipantAddForm;

  private destroy$ = new Subject<void>();
  private fb = inject(FormBuilder);
  private consultationService = inject(ConsultationService);
  private toasterService = inject(ToasterService);
  private userService = inject(UserService);
  private t = inject(TranslationService);

  isSubmitting = signal(false);
  currentUser = signal<IUser | null>(null);
  appointmentForm!: FormGroup;
  backendErrors = signal<Record<string, string[]>>({});
  // "Now" mode: no schedule is sent, the backend starts the appointment
  // immediately.
  isImmediate = signal(false);

  participants = signal<Participant[]>([]);
  pendingParticipants = signal<CreateParticipantRequest[]>([]);
  isLoadingParticipants = signal(false);
  isAddingParticipant = signal(false);
  showAddParticipantForm = signal(false);

  protected readonly ButtonStyleEnum = ButtonStyleEnum;
  protected readonly ButtonSizeEnum = ButtonSizeEnum;
  protected readonly ButtonStateEnum = ButtonStateEnum;
  protected readonly BadgeTypeEnum = BadgeTypeEnum;
  protected readonly BadgeSizeEnum = BadgeSizeEnum;
  protected readonly AppointmentType = AppointmentType;

  get isEditMode(): boolean {
    return this.editingAppointment !== null;
  }

  get submitButtonText(): string {
    return this.isEditMode
      ? this.t.instant('appointmentForm.saveChanges')
      : this.t.instant('appointmentForm.createAppointment');
  }

  ngOnInit(): void {
    this.initForm();
    this.loadCurrentUser();
    this.updateInviteCheckboxStates();

    // When the component is created with an appointment already set (e.g. the
    // modal is wrapped in an @if), populate the edit state here since
    // ngOnChanges fired before the form existed.
    if (this.editingAppointment) {
      this.populateFormForEdit();
      this.loadParticipants();
    } else if (this.initialParticipants.length) {
      // Pre-fill participants (e.g. creating an appointment from a contact page).
      this.pendingParticipants.set([...this.initialParticipants]);
    }

    // Clear backend errors when form values change
    this.appointmentForm.valueChanges
      .pipe(takeUntil(this.destroy$))
      .subscribe(() => {
        if (Object.keys(this.backendErrors()).length > 0) {
          this.backendErrors.set({});
        }
      });
  }

  private loadCurrentUser(): void {
    this.userService.currentUser$
      .pipe(takeUntil(this.destroy$))
      .subscribe(user => {
        this.currentUser.set(user);
      });
    if (!this.currentUser()) {
      this.userService
        .getCurrentUser()
        .pipe(takeUntil(this.destroy$))
        .subscribe();
    }
  }

  isBeneficiaryCheckboxDisabled(): boolean {
    return !this.beneficiary;
  }

  isPractitionerCheckboxDisabled(): boolean {
    return !this.owner;
  }

  // Shown only when creating an appointment from a contact page (the contact
  // is pre-added as a participant).
  get showContactInviteFlag(): boolean {
    return !this.isEditMode && this.initialParticipants.length > 0;
  }

  // True if a pending participant is one of the contacts pre-added from a
  // contact page (used to grey it out when "don't invite the contact" is on).
  isInitialContact(pending: CreateParticipantRequest): boolean {
    if (!this.showContactInviteFlag || !pending.user_id) return false;
    return this.initialParticipants.some(p => p.user_id === pending.user_id);
  }

  getBeneficiaryUser(): User | null {
    return this.beneficiary;
  }

  getOwnerUser(): User | null {
    return this.owner;
  }

  getCurrentUserForInvite(): IUser | null {
    // Already listed as the practitioner or the patient: showing a second
    // "You" row would be the same person twice.
    if (this.isCurrentUserOwner() || this.isCurrentUserBeneficiary()) {
      return null;
    }
    return this.currentUser();
  }

  private isCurrentUserOwner(): boolean {
    const me = this.currentUser();
    return !!me && !!this.owner && this.owner.id === me.pk;
  }

  private isCurrentUserBeneficiary(): boolean {
    const me = this.currentUser();
    return !!me && !!this.beneficiary && this.beneficiary.id === me.pk;
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['editingAppointment'] && this.appointmentForm) {
      this.resetForm();
      if (this.editingAppointment) {
        this.populateFormForEdit();
        this.loadParticipants();
      } else if (this.initialParticipants.length) {
        this.pendingParticipants.set([...this.initialParticipants]);
      }
    }
    if ((changes['beneficiary'] || changes['owner']) && this.appointmentForm) {
      this.updateInviteCheckboxStates();
    }
    if (
      (changes['initialStartDate'] || changes['initialEndDate']) &&
      this.appointmentForm &&
      !this.editingAppointment
    ) {
      this.populateFormWithInitialDates();
    }
    const highlightKeys = [
      'highlightAddParticipant',
      'highlightExternalGuest',
      'highlightExternalEmail',
      'highlightVisibleCheckbox',
      'highlightAddParticipantSubmit',
      'highlightDateTime',
    ];
    if (highlightKeys.some(key => changes[key]?.currentValue)) {
      this.scrollHighlightedIntoView();
    }
  }

  private scrollHighlightedIntoView(): void {
    setTimeout(() => {
      const el = document.querySelector<HTMLElement>('.wizard-highlight-target');
      el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 60);
  }

  updateInviteCheckboxStates(): void {
    const beneficiaryControl = this.appointmentForm.get(
      'dont_invite_beneficiary'
    );
    const practitionerControl = this.appointmentForm.get(
      'dont_invite_practitioner'
    );

    if (this.isBeneficiaryCheckboxDisabled()) {
      beneficiaryControl?.disable();
    } else {
      beneficiaryControl?.enable();
    }

    if (this.isPractitionerCheckboxDisabled()) {
      practitionerControl?.disable();
    } else {
      practitionerControl?.enable();
    }
  }

  toggleInvite(controlName: string, invited: boolean): void {
    this.appointmentForm.get(controlName)?.setValue(!invited);

    // When the signed-in user is also the practitioner or the patient, that
    // single row drives their invitation: mirror it onto dont_invite_me,
    // which the backend evaluates separately.
    const mirrors =
      (controlName === 'dont_invite_practitioner' &&
        this.isCurrentUserOwner()) ||
      (controlName === 'dont_invite_beneficiary' &&
        this.isCurrentUserBeneficiary());
    if (mirrors) {
      this.appointmentForm.get('dont_invite_me')?.setValue(!invited);
    }
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  private initForm(): void {
    this.appointmentForm = this.fb.group({
      type: [AppointmentType.ONLINE, [Validators.required]],
      title: [''],
      // Left empty, the appointment is created as immediate.
      date: [''],
      time: [''],
      end_date: [''],
      end_time: [''],
      dont_invite_beneficiary: [false],
      dont_invite_practitioner: [false],
      dont_invite_contact: [false],
      dont_invite_me: [false],
    });
  }

  /** Toggle the "now" mode: clears and locks the schedule fields. */
  toggleImmediate(): void {
    const immediate = !this.isImmediate();
    this.isImmediate.set(immediate);

    const scheduleControls = ['date', 'time', 'end_date', 'end_time'];
    for (const name of scheduleControls) {
      const control = this.appointmentForm.get(name);
      if (!control) continue;
      if (immediate) {
        control.setValue('');
        control.disable();
      } else {
        control.enable();
      }
    }

    if (immediate) {
      this.backendErrors.set({});
    }
  }

  resetForm(): void {
    this.isImmediate.set(false);
    ['date', 'time', 'end_date', 'end_time'].forEach(name =>
      this.appointmentForm.get(name)?.enable()
    );
    this.appointmentForm.reset({
      type: AppointmentType.ONLINE,
      dont_invite_beneficiary: false,
      dont_invite_practitioner: false,
      dont_invite_contact: false,
      dont_invite_me: false,
    });
    this.participants.set([]);
    this.pendingParticipants.set([]);
    this.showAddParticipantForm.set(false);
    this.addParticipantForm?.reset();
    this.backendErrors.set({});
  }

  getFieldError(fieldName: string): string {
    const errors = this.backendErrors();
    if (errors[fieldName] && errors[fieldName].length > 0) {
      return errors[fieldName][0];
    }
    return '';
  }

  getAppointmentFieldError(fieldName: string): string {
    // Check backend errors first
    const backendError = this.getFieldError(fieldName);
    if (backendError) {
      return backendError;
    }

    // Check validation errors
    const control = this.appointmentForm.get(fieldName);
    if (control && control.invalid && control.touched) {
      if (control.hasError('required')) {
        return this.t.instant('appointmentForm.fieldRequired');
      }
    }
    return '';
  }

  private populateFormForEdit(): void {
    if (!this.editingAppointment) return;

    const dateStr = extractDateFromISO(this.editingAppointment.scheduled_at);
    const timeStr = extractTimeFromISO(this.editingAppointment.scheduled_at);

    let endDateStr = '';
    let endTimeStr = '';
    if (this.editingAppointment.end_expected_at) {
      endDateStr = extractDateFromISO(this.editingAppointment.end_expected_at);
      endTimeStr = extractTimeFromISO(this.editingAppointment.end_expected_at);
    }

    this.appointmentForm.patchValue({
      type: this.editingAppointment.type || AppointmentType.ONLINE,
      title: this.editingAppointment.title || '',
      date: dateStr,
      time: timeStr,
      end_date: endDateStr,
      end_time: endTimeStr,
    });
  }

  private populateFormWithInitialDates(): void {
    if (!this.initialStartDate) return;

    const formatDate = (date: Date): string => {
      const year = date.getFullYear();
      const month = String(date.getMonth() + 1).padStart(2, '0');
      const day = String(date.getDate()).padStart(2, '0');
      return `${year}-${month}-${day}`;
    };

    const formatTime = (date: Date): string => {
      const hours = String(date.getHours()).padStart(2, '0');
      const minutes = String(date.getMinutes()).padStart(2, '0');
      return `${hours}:${minutes}`;
    };

    const dateStr = formatDate(this.initialStartDate);
    const timeStr = formatTime(this.initialStartDate);

    let endDateStr = '';
    let endTimeStr = '';
    if (this.initialEndDate) {
      endDateStr = formatDate(this.initialEndDate);
      endTimeStr = formatTime(this.initialEndDate);
    }

    this.appointmentForm.patchValue({
      date: dateStr,
      time: timeStr,
      end_date: endDateStr,
      end_time: endTimeStr,
    });
  }

  loadParticipants(): void {
    if (!this.editingAppointment) return;

    // Deactivated participants stay listed so they can be switched back on:
    // omitting an id deactivates it server-side, sending it again revives it.
    this.participants.set([...this.editingAppointment.participants]);
  }

  setAppointmentType(type: AppointmentType): void {
    this.appointmentForm.patchValue({ type });
  }

  openAddParticipantModal(): void {
    this.showAddParticipantForm.set(true);
    this.addParticipantClicked.emit();
  }

  closeAddParticipantModal(): void {
    this.showAddParticipantForm.set(false);
  }

  /**
   * Queue a participant described in the modal. Nothing is sent to the API
   * here: the pending list is flushed with the appointment on submit.
   */
  onParticipantAdded(data: CreateParticipantRequest): void {
    this.pendingParticipants.update(list => [...list, data]);
    this.addParticipantForm?.reset();
    this.showAddParticipantForm.set(false);
    // The wizard only tracks guests created from scratch, not users picked
    // from the directory.
    if (!data.user_id) {
      this.participantAdded.emit();
    }
  }

  getTotalParticipantsCount(): number {
    let count =
      this.participants().filter(p => p.is_active).length +
      this.pendingParticipants().length;
    if (!this.isEditMode) {
      if (this.beneficiary) count++;
      if (this.owner) count++;
      // Counted through their other role when they hold one.
      if (this.getCurrentUserForInvite()) count++;
    }
    return count;
  }

  removePendingParticipant(index: number): void {
    this.pendingParticipants.update(list => list.filter((_, i) => i !== index));
  }

  /** Editing an appointment excludes a participant rather than deleting them. */
  setParticipantActive(participant: Participant, active: boolean): void {
    this.participants.update(list =>
      list.map(p => (p.id === participant.id ? { ...p, is_active: active } : p))
    );
  }

  onCancel(): void {
    this.cancelled.emit();
  }

  submit(): void {
    // Mark all fields as touched to show validation errors
    Object.keys(this.appointmentForm.controls).forEach(key => {
      this.appointmentForm.get(key)?.markAsTouched();
    });

    if (!this.appointmentForm.valid) return;

    const formValue = this.appointmentForm.getRawValue();

    // No date/time means an immediate appointment: the backend schedules it now.
    let scheduledAt: string | undefined;
    if (!this.isImmediate() && (formValue.date || formValue.time)) {
      if (!formValue.date || !formValue.time) {
        this.backendErrors.set({
          date: formValue.date ? [] : [this.t.instant('appointmentForm.fieldRequired')],
          time: formValue.time ? [] : [this.t.instant('appointmentForm.fieldRequired')],
        });
        return;
      }
      scheduledAt = `${formValue.date}T${formValue.time}`;

      // Validate scheduled time is not in the past. Editing an existing
      // appointment is exempt: a past appointment must stay editable.
      if (!this.isEditMode && new Date(scheduledAt) < new Date()) {
        this.backendErrors.set({
          date: [this.t.instant('appointmentForm.scheduledInPast')],
          time: [this.t.instant('appointmentForm.scheduledInPast')],
        });
        return;
      }
    }

    this.isSubmitting.set(true);

    let endExpectedAt: string | undefined;
    if (!this.isImmediate() && formValue.end_date && formValue.end_time) {
      endExpectedAt = `${formValue.end_date}T${formValue.end_time}`;
    }

    const { participants_ids, temporary_participants, participants_visibility } =
      this.getParticipantsForRequest();

    if (this.isEditMode && this.editingAppointment) {
      const updateData: UpdateAppointmentRequest = {
        type: formValue.type as AppointmentType,
        title: formValue.title || undefined,
        scheduled_at: scheduledAt,
        end_expected_at: endExpectedAt,
        participants_ids,
        temporary_participants,
        participants_visibility,
      };
      this.updateAppointment(updateData);
    } else {
      const createData: CreateAppointmentRequest = {
        type: formValue.type as AppointmentType,
        title: formValue.title || undefined,
        scheduled_at: scheduledAt,
        end_expected_at: endExpectedAt,
        dont_invite_beneficiary: formValue.dont_invite_beneficiary || false,
        dont_invite_practitioner: formValue.dont_invite_practitioner || false,
        dont_invite_me: formValue.dont_invite_me || false,
        participants_ids,
        temporary_participants,
        participants_visibility,
      };

      if (!this.autoSave) {
        this.isSubmitting.set(false);
        this.appointmentDataReady.emit(createData);
      } else {
        this.createAppointment(createData);
      }
    }
  }

  private getParticipantsForRequest(): {
    participants_ids: number[];
    temporary_participants: ITemporaryParticipant[];
    participants_visibility: { user_id: number; is_consultation_visible: boolean }[];
  } {
    const participants_ids: number[] = [];
    const temporary_participants: ITemporaryParticipant[] = [];
    const participants_visibility: { user_id: number; is_consultation_visible: boolean }[] = [];

    // When created from a contact page, "don't invite the contact" excludes the
    // pre-added contact(s) from the request.
    const excludedContactIds =
      this.showContactInviteFlag &&
      this.appointmentForm.get('dont_invite_contact')?.value
        ? this.initialParticipants
            .map(p => p.user_id)
            .filter((id): id is number => !!id)
        : [];

    for (const p of this.participants()) {
      if (p.is_active && p.user?.id) {
        participants_ids.push(p.user.id);
      }
    }

    for (const pending of this.pendingParticipants()) {
      if (pending.user_id && excludedContactIds.includes(pending.user_id)) {
        continue;
      }
      if (pending.user_id) {
        participants_ids.push(pending.user_id);
        if (pending.is_consultation_visible) {
          participants_visibility.push({
            user_id: pending.user_id,
            is_consultation_visible: true,
          });
        }
      } else {
        const tempParticipant: ITemporaryParticipant = {};
        if (pending.first_name) {
          tempParticipant.first_name = pending.first_name;
        }
        if (pending.last_name) {
          tempParticipant.last_name = pending.last_name;
        }
        if (pending.email) {
          tempParticipant.email = pending.email;
        }
        if (pending.mobile_phone_number) {
          tempParticipant.mobile_phone_number = pending.mobile_phone_number;
        }
        if (pending.timezone) {
          tempParticipant.timezone = pending.timezone;
        }
        if (pending.communication_method) {
          tempParticipant.communication_method = pending.communication_method;
        }
        if (pending.preferred_language) {
          tempParticipant.preferred_language = pending.preferred_language;
        }
        if (pending.is_consultation_visible) {
          tempParticipant.is_consultation_visible = true;
        }
        temporary_participants.push(tempParticipant);
      }
    }

    return { participants_ids, temporary_participants, participants_visibility };
  }

  private updateAppointment(appointmentData: UpdateAppointmentRequest): void {
    if (!this.editingAppointment) return;

    this.backendErrors.set({});
    this.consultationService
      .updateAppointment(this.editingAppointment.id, appointmentData)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: updatedAppointment => {
          this.isSubmitting.set(false);
          this.appointmentUpdated.emit(updatedAppointment);
        },
        error: error => {
          this.isSubmitting.set(false);

          if (error.status === 400 && error.error) {
            const backendErrors = error.error;
            const mappedErrors: Record<string, string[]> = {};

            // Map backend field names to form field names
            if (backendErrors['scheduled_at']) {
              mappedErrors['date'] = backendErrors['scheduled_at'];
              mappedErrors['time'] = backendErrors['scheduled_at'];
            }
            if (backendErrors['end_expected_at']) {
              mappedErrors['end_date'] = backendErrors['end_expected_at'];
              mappedErrors['end_time'] = backendErrors['end_expected_at'];
            }
            // Copy other errors as-is
            Object.keys(backendErrors).forEach(key => {
              if (key !== 'scheduled_at' && key !== 'end_expected_at') {
                mappedErrors[key] = backendErrors[key];
              }
            });

            this.backendErrors.set(mappedErrors);
          } else {
            this.toasterService.show(
              'error',
              this.t.instant('appointmentForm.errorUpdatingAppointment'),
              getErrorMessage(error)
            );
          }
        },
      });
  }

  private createAppointment(appointmentData: CreateAppointmentRequest): void {
    this.backendErrors.set({});
    const createObservable = this.consultationId
      ? this.consultationService.createConsultationAppointment(
          this.consultationId,
          appointmentData
        )
      : this.consultationService.createAppointment(appointmentData);

    createObservable.pipe(takeUntil(this.destroy$)).subscribe({
      next: appointment => {
        this.isSubmitting.set(false);
        this.toasterService.show(
          'success',
          this.t.instant('appointmentForm.appointmentCreated'),
          this.t.instant('appointmentForm.appointmentCreatedMessage')
        );
        this.appointmentCreated.emit(appointment);
      },
      error: error => {
        this.isSubmitting.set(false);

        if (error.status === 400 && error.error) {
          const backendErrors = error.error;
          const mappedErrors: Record<string, string[]> = {};

          // Map backend field names to form field names
          if (backendErrors['scheduled_at']) {
            mappedErrors['date'] = backendErrors['scheduled_at'];
            mappedErrors['time'] = backendErrors['scheduled_at'];
          }
          if (backendErrors['end_expected_at']) {
            mappedErrors['end_date'] = backendErrors['end_expected_at'];
            mappedErrors['end_time'] = backendErrors['end_expected_at'];
          }
          // Copy other errors as-is
          Object.keys(backendErrors).forEach(key => {
            if (key !== 'scheduled_at' && key !== 'end_expected_at') {
              mappedErrors[key] = backendErrors[key];
            }
          });

          this.backendErrors.set(mappedErrors);
        } else {
          this.toasterService.show(
            'error',
            this.t.instant('appointmentForm.errorCreatingAppointment'),
            getErrorMessage(error)
          );
        }
      },
    });
  }
}
