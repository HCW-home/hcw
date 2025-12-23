import { Component, Input, Output, EventEmitter, OnInit, OnDestroy, OnChanges, SimpleChanges, signal, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import {
  FormBuilder,
  FormGroup,
  FormArray,
  Validators,
  ReactiveFormsModule,
} from '@angular/forms';
import { Subject, takeUntil } from 'rxjs';

import { ConsultationService } from '../../../../../core/services/consultation.service';
import { ToasterService } from '../../../../../core/services/toaster.service';
import { Appointment, CreateAppointmentRequest, CreateParticipantRequest } from '../../../../../core/models/consultation';
import { IUser } from '../../../models/user';

import { ModalComponent } from '../../../../../shared/components/modal/modal.component';
import { Button } from '../../../../../shared/ui-components/button/button';
import { Input as InputComponent } from '../../../../../shared/ui-components/input/input';
import { Svg } from '../../../../../shared/ui-components/svg/svg';
import { UserSearchSelect } from '../../../../../shared/components/user-search-select/user-search-select';
import { ButtonStyleEnum, ButtonSizeEnum, ButtonStateEnum } from '../../../../../shared/constants/button';
import { getErrorMessage } from '../../../../../core/utils/error-helper';

interface ParticipantFormValue {
  isExistingUser: boolean;
  user_id: number | null;
  selectedUser: IUser | null;
  name: string;
  email: string;
  contactType: string;
}

@Component({
  selector: 'app-appointment-form-modal',
  templateUrl: './appointment-form-modal.html',
  styleUrl: './appointment-form-modal.scss',
  imports: [
    CommonModule,
    ReactiveFormsModule,
    ModalComponent,
    Button,
    InputComponent,
    Svg,
    UserSearchSelect,
  ],
})
export class AppointmentFormModal implements OnInit, OnDestroy, OnChanges {
  @Input() isOpen = false;
  @Input() consultationId!: number;
  @Input() editingAppointment: Appointment | null = null;

  @Output() closed = new EventEmitter<void>();
  @Output() appointmentCreated = new EventEmitter<Appointment>();
  @Output() appointmentUpdated = new EventEmitter<Appointment>();

  private destroy$ = new Subject<void>();
  private fb = inject(FormBuilder);
  private consultationService = inject(ConsultationService);
  private toasterService = inject(ToasterService);

  isSubmitting = signal(false);
  appointmentForm!: FormGroup;

  protected readonly ButtonStyleEnum = ButtonStyleEnum;
  protected readonly ButtonSizeEnum = ButtonSizeEnum;
  protected readonly ButtonStateEnum = ButtonStateEnum;

  get participantsFormArray(): FormArray {
    return this.appointmentForm.get('participants') as FormArray;
  }

  get isEditMode(): boolean {
    return this.editingAppointment !== null;
  }

  get modalTitle(): string {
    return this.isEditMode ? 'Edit Appointment' : 'Create New Appointment';
  }

  get submitButtonText(): string {
    return this.isEditMode ? 'Save Changes' : 'Create Appointment';
  }

  ngOnInit(): void {
    this.initForm();
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['isOpen'] && changes['isOpen'].currentValue === true) {
      if (this.appointmentForm) {
        this.appointmentForm.reset({ type: 'Online' });
        this.participantsFormArray.clear();
        if (this.editingAppointment) {
          this.populateFormForEdit();
        }
      }
    }
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  private initForm(): void {
    this.appointmentForm = this.fb.group({
      type: ['Online', [Validators.required]],
      date: ['', [Validators.required]],
      time: ['', [Validators.required]],
      end_expected_at: [''],
      participants: this.fb.array([]),
    });

    if (this.editingAppointment) {
      this.populateFormForEdit();
    }
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
      type: this.editingAppointment.type || 'Online',
      date: dateStr,
      time: timeStr,
      end_expected_at: endExpectedAt,
    });
  }

  createParticipantFormGroup(): FormGroup {
    return this.fb.group({
      isExistingUser: [false],
      user_id: [null],
      selectedUser: [null],
      name: [''],
      email: [''],
      contactType: ['email'],
    });
  }

  setAppointmentType(type: string): void {
    this.appointmentForm.patchValue({ type });
  }

  addParticipant(): void {
    this.participantsFormArray.push(this.createParticipantFormGroup());
  }

  removeParticipant(index: number): void {
    this.participantsFormArray.removeAt(index);
  }

  setParticipantContactType(index: number, type: string): void {
    const participant = this.participantsFormArray.at(index);
    participant.patchValue({ contactType: type });
  }

  getParticipantContactType(index: number): string {
    const participant = this.participantsFormArray.at(index);
    return participant.get('contactType')?.value || 'email';
  }

  isParticipantExistingUser(index: number): boolean {
    const participant = this.participantsFormArray.at(index);
    return participant.get('isExistingUser')?.value || false;
  }

  setParticipantType(index: number, isExisting: boolean): void {
    const participant = this.participantsFormArray.at(index);
    participant.patchValue({
      isExistingUser: isExisting,
      user_id: null,
      selectedUser: null,
      name: '',
      email: '',
    });
  }

  onParticipantUserSelected(index: number, user: IUser | null): void {
    const participant = this.participantsFormArray.at(index);
    if (user) {
      participant.patchValue({
        user_id: user.pk,
        selectedUser: user,
      });
    } else {
      participant.patchValue({
        user_id: null,
        selectedUser: null,
      });
    }
  }

  onClose(): void {
    this.appointmentForm.reset({ type: 'Online' });
    this.participantsFormArray.clear();
    this.closed.emit();
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

    const appointmentData: CreateAppointmentRequest = {
      type: formValue.type,
      scheduled_at: scheduledAt,
      end_expected_at: endExpectedAt,
    };

    if (this.isEditMode) {
      this.updateAppointment(appointmentData);
    } else {
      this.createAppointment(appointmentData, formValue.participants);
    }
  }

  private updateAppointment(appointmentData: CreateAppointmentRequest): void {
    if (!this.editingAppointment) return;

    this.consultationService
      .updateAppointment(this.editingAppointment.id, appointmentData)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (updatedAppointment) => {
          this.isSubmitting.set(false);
          this.toasterService.show('success', 'Appointment updated successfully');
          this.appointmentUpdated.emit(updatedAppointment);
          this.onClose();
        },
        error: (error) => {
          this.isSubmitting.set(false);
          this.toasterService.show('error', getErrorMessage(error));
        },
      });
  }

  private createAppointment(appointmentData: CreateAppointmentRequest, participants: ParticipantFormValue[]): void {
    this.consultationService
      .createConsultationAppointment(this.consultationId, appointmentData)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (appointment) => {
          const validParticipants = participants.filter((p: ParticipantFormValue) =>
            (p.isExistingUser && p.user_id) || (!p.isExistingUser && p.email)
          );

          if (validParticipants.length > 0) {
            this.createParticipants(appointment, validParticipants);
          } else {
            this.finalizeCreation(appointment);
          }
        },
        error: (error) => {
          this.isSubmitting.set(false);
          this.toasterService.show('error', getErrorMessage(error));
        },
      });
  }

  private createParticipants(appointment: Appointment, participants: ParticipantFormValue[]): void {
    const requests = participants.map(p => {
      const data: CreateParticipantRequest = {
        message_type: p.contactType === 'email' ? 'email' : 'sms',
      };
      if (p.isExistingUser && p.user_id) {
        data.user_id = p.user_id;
      } else if (p.contactType === 'email') {
        data.email = p.email;
      } else {
        data.phone = p.email;
      }
      return this.consultationService.addAppointmentParticipant(appointment.id, data).toPromise();
    });

    Promise.all(requests)
      .then(() => {
        this.finalizeCreation(appointment);
      })
      .catch(() => {
        this.finalizeCreation(appointment);
        this.toasterService.show('warning', 'Appointment created but some participants could not be added');
      });
  }

  private finalizeCreation(appointment: Appointment): void {
    this.isSubmitting.set(false);
    this.toasterService.show('success', 'Appointment created successfully');
    this.appointmentCreated.emit(appointment);
    this.onClose();
  }
}
