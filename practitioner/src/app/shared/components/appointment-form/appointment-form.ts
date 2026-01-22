import {
  Component,
  Input,
  Output,
  EventEmitter,
  OnInit,
  OnDestroy,
  OnChanges,
  SimpleChanges,
  signal,
  inject,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import {
  FormBuilder,
  FormGroup,
  Validators,
  ReactiveFormsModule,
} from '@angular/forms';
import { Subject, takeUntil } from 'rxjs';

import { ConsultationService } from '../../../core/services/consultation.service';
import { ConfirmationService } from '../../../core/services/confirmation.service';
import { ToasterService } from '../../../core/services/toaster.service';
import {
  Appointment,
  Participant,
  CreateParticipantRequest,
  AppointmentType,
} from '../../../core/models/consultation';
import { IUser } from '../../../modules/user/models/user';

import { Button } from '../../ui-components/button/button';
import { Input as InputComponent } from '../../ui-components/input/input';
import { Select } from '../../ui-components/select/select';
import { Checkbox } from '../../ui-components/checkbox/checkbox';
import { Svg } from '../../ui-components/svg/svg';
import { Badge } from '../badge/badge';
import { Loader } from '../loader/loader';
import { UserSearchSelect } from '../user-search-select/user-search-select';
import { ButtonStyleEnum, ButtonSizeEnum, ButtonStateEnum } from '../../constants/button';
import { BadgeTypeEnum } from '../../constants/badge';
import { SelectOption } from '../../models/select';
import { getParticipantBadgeType } from '../../tools/helper';
import { getErrorMessage } from '../../../core/utils/error-helper';
import { TIMEZONE_OPTIONS } from '../../constants/timezone';

@Component({
  selector: 'app-appointment-form',
  templateUrl: './appointment-form.html',
  styleUrl: './appointment-form.scss',
  imports: [
    CommonModule,
    ReactiveFormsModule,
    Button,
    InputComponent,
    Select,
    Checkbox,
    Svg,
    Badge,
    Loader,
    UserSearchSelect,
  ],
})
export class AppointmentForm implements OnInit, OnDestroy, OnChanges {
  @Input() consultationId!: number;
  @Input() editingAppointment: Appointment | null = null;
  @Input() showActions = true;

  @Output() cancelled = new EventEmitter<void>();
  @Output() appointmentCreated = new EventEmitter<Appointment>();
  @Output() appointmentUpdated = new EventEmitter<Appointment>();

  private destroy$ = new Subject<void>();
  private fb = inject(FormBuilder);
  private consultationService = inject(ConsultationService);
  private confirmationService = inject(ConfirmationService);
  private toasterService = inject(ToasterService);

  isSubmitting = signal(false);
  appointmentForm!: FormGroup;

  participants = signal<Participant[]>([]);
  pendingParticipants = signal<CreateParticipantRequest[]>([]);
  isLoadingParticipants = signal(false);
  isAddingParticipant = signal(false);
  showAddParticipantForm = signal(false);
  isExistingUser = signal(true);
  selectedParticipantUser = signal<IUser | null>(null);
  participantForm!: FormGroup;

  timezoneOptions: SelectOption[] = TIMEZONE_OPTIONS;

  communicationMethods: SelectOption[] = [
    { value: 'email', label: 'Email' },
    { value: 'sms', label: 'SMS' },
    { value: 'whatsapp', label: 'WhatsApp' },
    { value: 'push', label: 'Push Notification' },
  ];

  languageOptions: SelectOption[] = [
    { value: 'en', label: 'English' },
    { value: 'de', label: 'German' },
    { value: 'fr', label: 'French' },
  ];

  protected readonly ButtonStyleEnum = ButtonStyleEnum;
  protected readonly ButtonSizeEnum = ButtonSizeEnum;
  protected readonly ButtonStateEnum = ButtonStateEnum;
  protected readonly BadgeTypeEnum = BadgeTypeEnum;
  protected readonly AppointmentType = AppointmentType;
  protected readonly getParticipantBadgeType = getParticipantBadgeType;

  get isEditMode(): boolean {
    return this.editingAppointment !== null;
  }

  get submitButtonText(): string {
    return this.isEditMode ? 'Save Changes' : 'Create Appointment';
  }

  ngOnInit(): void {
    this.initForm();
    this.initParticipantForm();
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['editingAppointment'] && this.appointmentForm) {
      this.resetForm();
      if (this.editingAppointment) {
        this.populateFormForEdit();
        this.loadParticipants();
      }
    }
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  private initForm(): void {
    this.appointmentForm = this.fb.group({
      type: [AppointmentType.ONLINE, [Validators.required]],
      date: ['', [Validators.required]],
      time: ['', [Validators.required]],
      end_expected_at: [''],
      dont_invite_beneficiary: [false],
      dont_invite_practitioner: [false],
      dont_invite_me: [false],
    });
  }

  private initParticipantForm(): void {
    this.participantForm = this.fb.group({
      user_id: [null],
      first_name: [''],
      last_name: [''],
      email: ['', [Validators.email]],
      phone: [''],
      message_type: ['email', [Validators.required]],
      timezone: ['UTC'],
      communication_method: ['email'],
      preferred_language: ['en'],
    });
  }

  resetForm(): void {
    this.appointmentForm.reset({
      type: AppointmentType.ONLINE,
      dont_invite_beneficiary: false,
      dont_invite_practitioner: false,
      dont_invite_me: false,
    });
    this.participants.set([]);
    this.pendingParticipants.set([]);
    this.showAddParticipantForm.set(false);
    this.isExistingUser.set(true);
    this.selectedParticipantUser.set(null);
    this.participantForm.reset({
      message_type: 'email',
      timezone: 'UTC',
      communication_method: 'email',
      preferred_language: 'en',
    });
  }

  private populateFormForEdit(): void {
    if (!this.editingAppointment) return;

    const scheduledDate = new Date(this.editingAppointment.scheduled_at);
    const dateStr = scheduledDate.toISOString().split('T')[0];
    const timeStr = scheduledDate.toTimeString().slice(0, 5);

    let endExpectedAt = '';
    if (this.editingAppointment.end_expected_at) {
      const endDate = new Date(this.editingAppointment.end_expected_at);
      endExpectedAt = endDate.toISOString().slice(0, 16);
    }

    this.appointmentForm.patchValue({
      type: this.editingAppointment.type || AppointmentType.ONLINE,
      date: dateStr,
      time: timeStr,
      end_expected_at: endExpectedAt,
    });
  }

  loadParticipants(): void {
    if (!this.editingAppointment) return;

    this.isLoadingParticipants.set(true);
    this.consultationService
      .getAppointmentParticipants(this.editingAppointment.id)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (response) => {
          this.participants.set(response.results);
          this.isLoadingParticipants.set(false);
        },
        error: (error) => {
          this.isLoadingParticipants.set(false);
          this.toasterService.show('error', getErrorMessage(error));
        },
      });
  }

  setAppointmentType(type: AppointmentType): void {
    this.appointmentForm.patchValue({ type });
  }

  setParticipantType(isExisting: boolean): void {
    this.isExistingUser.set(isExisting);
    this.selectedParticipantUser.set(null);
    this.participantForm.reset({
      message_type: 'email',
      timezone: 'UTC',
      communication_method: 'email',
      preferred_language: 'en',
      user_id: null,
    });
  }

  setParticipantMessageType(type: string): void {
    this.participantForm.patchValue({ message_type: type });
  }

  onParticipantUserSelected(user: IUser | null): void {
    this.selectedParticipantUser.set(user);
    if (user) {
      this.participantForm.patchValue({ user_id: user.pk });
    } else {
      this.participantForm.patchValue({ user_id: null });
    }
  }

  toggleAddParticipantForm(): void {
    this.showAddParticipantForm.update(v => !v);
    if (!this.showAddParticipantForm()) {
      this.resetParticipantForm();
    }
  }

  addParticipant(): void {
    const formValue = this.participantForm.value;
    const data: CreateParticipantRequest = {
      message_type: formValue.message_type,
      timezone: formValue.timezone,
      communication_method: formValue.communication_method,
      preferred_language: formValue.preferred_language,
    };

    if (this.isExistingUser() && formValue.user_id) {
      data.user_id = formValue.user_id;
      const user = this.selectedParticipantUser();
      if (user) {
        data.first_name = user.first_name;
        data.last_name = user.last_name;
        data.email = user.email;
      }
    } else {
      if (formValue.first_name) {
        data.first_name = formValue.first_name;
      }
      if (formValue.last_name) {
        data.last_name = formValue.last_name;
      }

      if (formValue.message_type === 'email' && formValue.email) {
        data.email = formValue.email;
      } else if (formValue.message_type === 'sms' && formValue.phone) {
        data.phone = formValue.phone;
      } else {
        this.toasterService.show('error', 'Please provide contact information');
        return;
      }
    }

    if (this.isEditMode && this.editingAppointment) {
      this.isAddingParticipant.set(true);
      this.consultationService
        .addAppointmentParticipant(this.editingAppointment.id, data)
        .pipe(takeUntil(this.destroy$))
        .subscribe({
          next: () => {
            this.loadParticipants();
            this.resetParticipantForm();
            this.isAddingParticipant.set(false);
            this.toasterService.show('success', 'Participant added successfully');
          },
          error: (error) => {
            this.isAddingParticipant.set(false);
            this.toasterService.show('error', getErrorMessage(error));
          },
        });
    } else {
      this.pendingParticipants.update(list => [...list, data]);
      this.resetParticipantForm();
      this.toasterService.show('success', 'Participant added to list');
    }
  }

  private resetParticipantForm(): void {
    this.participantForm.reset({
      message_type: 'email',
      timezone: 'UTC',
      communication_method: 'email',
      preferred_language: 'en',
    });
    this.isExistingUser.set(true);
    this.selectedParticipantUser.set(null);
    this.showAddParticipantForm.set(false);
  }

  getTotalParticipantsCount(): number {
    return this.participants().length + this.pendingParticipants().length;
  }

  getPendingParticipantName(pending: CreateParticipantRequest): string {
    const name = `${pending.first_name || ''} ${pending.last_name || ''}`.trim();
    return name || pending.email || 'Participant';
  }

  getPendingParticipantInitials(pending: CreateParticipantRequest): string {
    const first = pending.first_name?.charAt(0) || '';
    const last = pending.last_name?.charAt(0) || '';
    if (first || last) {
      return (first + last).toUpperCase();
    }
    return pending.email?.charAt(0).toUpperCase() || '?';
  }

  removePendingParticipant(index: number): void {
    this.pendingParticipants.update(list => list.filter((_, i) => i !== index));
  }

  async removeParticipant(participant: Participant): Promise<void> {
    if (!this.editingAppointment) return;

    const confirmed = await this.confirmationService.confirm({
      title: 'Remove Participant',
      message: 'Are you sure you want to remove this participant?',
      confirmText: 'Remove',
      cancelText: 'Cancel',
      confirmStyle: 'danger',
    });

    if (confirmed) {
      this.consultationService
        .removeAppointmentParticipant(this.editingAppointment.id, participant.id)
        .pipe(takeUntil(this.destroy$))
        .subscribe({
          next: () => {
            const currentParticipants = this.participants();
            this.participants.set(currentParticipants.filter(p => p.id !== participant.id));
            this.toasterService.show('success', 'Participant removed successfully');
          },
          error: (error) => {
            this.toasterService.show('error', getErrorMessage(error));
          },
        });
    }
  }

  getUserDisplayName(participant: Participant): string {
    if (participant.user) {
      return (
        `${participant.user.first_name} ${participant.user.last_name}`.trim() ||
        participant.user.email
      );
    }
    if (participant.first_name || participant.last_name) {
      return `${participant.first_name || ''} ${participant.last_name || ''}`.trim();
    }
    return participant.email || 'Unknown';
  }

  getParticipantInitials(participant: Participant): string {
    if (participant.user) {
      const first = participant.user.first_name?.charAt(0) || '';
      const last = participant.user.last_name?.charAt(0) || '';
      return (first + last).toUpperCase() || '?';
    }
    if (participant.email) {
      return participant.email.charAt(0).toUpperCase();
    }
    return '?';
  }

  onCancel(): void {
    this.cancelled.emit();
  }

  submit(): void {
    if (!this.appointmentForm.valid) return;

    this.isSubmitting.set(true);
    const formValue = this.appointmentForm.value;

    const scheduledAt = new Date(`${formValue.date}T${formValue.time}`).toISOString();

    let endExpectedAt: string | undefined;
    if (formValue.end_expected_at && formValue.end_expected_at.trim() !== '') {
      const endDate = new Date(formValue.end_expected_at);
      if (!isNaN(endDate.getTime())) {
        endExpectedAt = endDate.toISOString();
      }
    }

    if (this.isEditMode && this.editingAppointment) {
      const updateData = {
        type: formValue.type as AppointmentType,
        scheduled_at: scheduledAt,
        end_expected_at: endExpectedAt,
        dont_invite_beneficiary: formValue.dont_invite_beneficiary || false,
        dont_invite_practitioner: formValue.dont_invite_practitioner || false,
        dont_invite_me: formValue.dont_invite_me || false,
      };
      this.updateAppointment(updateData);
    } else {
      const createData = {
        type: formValue.type as AppointmentType,
        scheduled_at: scheduledAt,
        end_expected_at: endExpectedAt,
        dont_invite_beneficiary: formValue.dont_invite_beneficiary || false,
        dont_invite_practitioner: formValue.dont_invite_practitioner || false,
        dont_invite_me: formValue.dont_invite_me || false,
        participants: this.pendingParticipants(),
      };
      this.createAppointment(createData);
    }
  }

  private updateAppointment(appointmentData: {
    type: AppointmentType;
    scheduled_at: string;
    end_expected_at?: string;
    dont_invite_beneficiary: boolean;
    dont_invite_practitioner: boolean;
    dont_invite_me: boolean;
  }): void {
    if (!this.editingAppointment) return;

    this.consultationService
      .updateAppointment(this.editingAppointment.id, appointmentData)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (updatedAppointment) => {
          this.isSubmitting.set(false);
          this.toasterService.show('success', 'Appointment updated successfully');
          this.appointmentUpdated.emit(updatedAppointment);
        },
        error: (error) => {
          this.isSubmitting.set(false);
          this.toasterService.show('error', getErrorMessage(error));
        },
      });
  }

  private createAppointment(appointmentData: {
    type: AppointmentType;
    scheduled_at: string;
    end_expected_at?: string;
    dont_invite_beneficiary: boolean;
    dont_invite_practitioner: boolean;
    dont_invite_me: boolean;
    participants: CreateParticipantRequest[];
  }): void {
    this.consultationService
      .createConsultationAppointment(this.consultationId, appointmentData)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (appointment) => {
          this.isSubmitting.set(false);
          this.toasterService.show('success', 'Appointment created successfully');
          this.appointmentCreated.emit(appointment);
        },
        error: (error) => {
          this.isSubmitting.set(false);
          this.toasterService.show('error', getErrorMessage(error));
        },
      });
  }
}
