import { Component, Input, Output, EventEmitter, OnDestroy, OnChanges, SimpleChanges, signal, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import {
  FormBuilder,
  FormGroup,
  Validators,
  ReactiveFormsModule,
} from '@angular/forms';
import { Subject, takeUntil } from 'rxjs';

import { ConsultationService } from '../../../../../core/services/consultation.service';
import { ConfirmationService } from '../../../../../core/services/confirmation.service';
import { ToasterService } from '../../../../../core/services/toaster.service';
import { Appointment, Participant, CreateParticipantRequest, AppointmentType } from '../../../../../core/models/consultation';
import { IUser } from '../../../models/user';

import { ModalComponent } from '../../../../../shared/components/modal/modal.component';
import { Button } from '../../../../../shared/ui-components/button/button';
import { Input as InputComponent } from '../../../../../shared/ui-components/input/input';
import { Svg } from '../../../../../shared/ui-components/svg/svg';
import { Badge } from '../../../../../shared/components/badge/badge';
import { Loader } from '../../../../../shared/components/loader/loader';
import { UserSearchSelect } from '../../../../../shared/components/user-search-select/user-search-select';
import { ButtonStyleEnum, ButtonSizeEnum, ButtonStateEnum } from '../../../../../shared/constants/button';
import { getParticipantBadgeType } from '../../../../../shared/tools/helper';
import { getErrorMessage } from '../../../../../core/utils/error-helper';

@Component({
  selector: 'app-manage-participants-modal',
  templateUrl: './manage-participants-modal.html',
  styleUrl: './manage-participants-modal.scss',
  imports: [
    CommonModule,
    ReactiveFormsModule,
    ModalComponent,
    Button,
    InputComponent,
    Svg,
    Badge,
    Loader,
    UserSearchSelect,
  ],
})
export class ManageParticipantsModal implements OnDestroy, OnChanges {
  @Input() isOpen = false;
  @Input() appointment: Appointment | null = null;

  @Output() closed = new EventEmitter<void>();
  @Output() participantsChanged = new EventEmitter<void>();

  private destroy$ = new Subject<void>();
  private fb = inject(FormBuilder);
  private consultationService = inject(ConsultationService);
  private confirmationService = inject(ConfirmationService);
  private toasterService = inject(ToasterService);

  participants = signal<Participant[]>([]);
  isLoadingParticipants = signal(false);
  isAddingParticipant = signal(false);
  isExistingUser = signal(false);
  selectedParticipantUser = signal<IUser | null>(null);

  participantForm: FormGroup;

  protected readonly ButtonStyleEnum = ButtonStyleEnum;
  protected readonly ButtonSizeEnum = ButtonSizeEnum;
  protected readonly ButtonStateEnum = ButtonStateEnum;
  protected readonly AppointmentType = AppointmentType;
  protected readonly getParticipantBadgeType = getParticipantBadgeType;

  constructor() {
    this.participantForm = this.fb.group({
      user_id: [null],
      first_name: [''],
      last_name: [''],
      email: ['', [Validators.email]],
      phone: [''],
      message_type: ['email', [Validators.required]],
    });
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['isOpen'] && changes['isOpen'].currentValue === true) {
      this.participants.set([]);
      this.isExistingUser.set(false);
      this.selectedParticipantUser.set(null);
      this.participantForm.reset({ message_type: 'email', first_name: '', last_name: '', user_id: null });
      if (this.appointment) {
        this.loadParticipants();
      }
    }
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  loadParticipants(): void {
    if (!this.appointment) return;

    this.isLoadingParticipants.set(true);
    this.consultationService
      .getAppointmentParticipants(this.appointment.id)
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

  formatDateTime(dateString: string): string {
    return new Date(dateString).toLocaleString();
  }

  getUserDisplayName(participant: Participant): string {
    if (participant.user) {
      const fullName = `${participant.user.first_name || ''} ${participant.user.last_name || ''}`.trim();
      return fullName || participant.user.email || 'Unknown';
    }
    return 'Unknown';
  }

  getParticipantInitials(participant: Participant): string {
    if (participant.user) {
      const first = participant.user.first_name?.charAt(0) || '';
      const last = participant.user.last_name?.charAt(0) || '';
      if (first || last) {
        return (first + last).toUpperCase();
      }
      if (participant.user.email) {
        return participant.user.email.charAt(0).toUpperCase();
      }
    }
    return '?';
  }

  setParticipantType(isExisting: boolean): void {
    this.isExistingUser.set(isExisting);
    this.selectedParticipantUser.set(null);
    this.participantForm.reset({ message_type: 'email', display_name: '', user_id: null });
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

  addParticipant(): void {
    if (!this.appointment) return;

    const formValue = this.participantForm.value;
    let data: CreateParticipantRequest;

    if (this.isExistingUser() && formValue.user_id) {
      data = {
        user_id: formValue.user_id,
        message_type: formValue.message_type,
      };
    } else {
      data = {
        message_type: formValue.message_type,
      };

      if (formValue.first_name) {
        data.first_name = formValue.first_name;
      }
      if (formValue.last_name) {
        data.last_name = formValue.last_name;
      }

      if (formValue.message_type === 'email' && formValue.email) {
        data.email = formValue.email;
      } else if (formValue.message_type === 'sms' && formValue.phone) {
        data.mobile_phone_number = formValue.phone;
      } else {
        this.toasterService.show('error', 'Please provide contact information');
        return;
      }
    }

    this.isAddingParticipant.set(true);
    this.consultationService
      .addAppointmentParticipant(this.appointment.id, data)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: () => {
          this.loadParticipants();
          this.isExistingUser.set(false);
          this.selectedParticipantUser.set(null);
          this.participantForm.reset({ message_type: 'email', first_name: '', last_name: '', user_id: null });
          this.isAddingParticipant.set(false);
          this.toasterService.show('success', 'Participant added successfully');
          this.participantsChanged.emit();
        },
        error: (error) => {
          this.isAddingParticipant.set(false);
          this.toasterService.show('error', getErrorMessage(error));
        },
      });
  }

  async removeParticipant(participant: Participant): Promise<void> {
    if (!this.appointment) return;

    const confirmed = await this.confirmationService.confirm({
      title: 'Remove Participant',
      message: 'Are you sure you want to remove this participant?',
      confirmText: 'Remove',
      cancelText: 'Cancel',
      confirmStyle: 'danger',
    });

    if (confirmed) {
      this.consultationService
        .removeAppointmentParticipant(this.appointment.id, participant.id)
        .pipe(takeUntil(this.destroy$))
        .subscribe({
          next: () => {
            const currentParticipants = this.participants();
            this.participants.set(
              currentParticipants.filter(p => p.id !== participant.id)
            );
            this.toasterService.show('success', 'Participant removed successfully');
            this.participantsChanged.emit();
          },
          error: (error) => {
            this.toasterService.show('error', getErrorMessage(error));
          },
        });
    }
  }

  onClose(): void {
    this.participantForm.reset({ message_type: 'email', display_name: '', user_id: null });
    this.isExistingUser.set(false);
    this.selectedParticipantUser.set(null);
    this.closed.emit();
  }
}
