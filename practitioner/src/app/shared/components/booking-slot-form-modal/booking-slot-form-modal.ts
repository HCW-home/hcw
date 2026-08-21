import {
  Component,
  EventEmitter,
  Input,
  OnChanges,
  OnDestroy,
  Output,
  SimpleChanges,
  inject,
  signal,
} from '@angular/core';
import {
  FormBuilder,
  FormGroup,
  ReactiveFormsModule,
  Validators,
} from '@angular/forms';
import { Subject, takeUntil } from 'rxjs';
import { TranslatePipe } from '@ngx-translate/core';

import { ModalComponent } from '../modal/modal.component';
import { Button } from '../../ui-components/button/button';
import { Input as InputComponent } from '../../ui-components/input/input';
import { Switch } from '../../ui-components/switch/switch';
import { Typography } from '../../ui-components/typography/typography';
import {
  ButtonSizeEnum,
  ButtonStateEnum,
  ButtonStyleEnum,
} from '../../constants/button';
import { TypographyTypeEnum } from '../../constants/typography';
import {
  BookingSlot,
  CreateBookingSlot,
} from '../../../core/models/consultation';
import { ConsultationService } from '../../../core/services/consultation.service';
import { ToasterService } from '../../../core/services/toaster.service';
import { ValidationService } from '../../../core/services/validation.service';
import { LoggerService } from '../../../core/services/logger.service';
import { ConfirmationService } from '../../../core/services/confirmation.service';
import { TranslationService } from '../../../core/services/translation.service';
import { getErrorMessage } from '../../../core/utils/error-helper';

/** One column of the weekly recurrence, in the order shown in the form. */
interface WeekDay {
  key: string;
  short: string;
}

const WEEK_DAYS: WeekDay[] = [
  { key: 'monday', short: 'configuration.dayMon' },
  { key: 'tuesday', short: 'configuration.dayTue' },
  { key: 'wednesday', short: 'configuration.dayWed' },
  { key: 'thursday', short: 'configuration.dayThu' },
  { key: 'friday', short: 'configuration.dayFri' },
  { key: 'saturday', short: 'configuration.daySat' },
  { key: 'sunday', short: 'configuration.daySun' },
];

// Sunday-first, to index with Date#getDay().
const DAY_KEYS = [
  'sunday',
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
];

/**
 * Self-contained create/edit modal for a bookable slot (BookingSlot). Owns the
 * form and the API calls so any page can host it with two inputs.
 */
@Component({
  selector: 'app-booking-slot-form-modal',
  templateUrl: './booking-slot-form-modal.html',
  styleUrl: './booking-slot-form-modal.scss',
  imports: [
    ReactiveFormsModule,
    ModalComponent,
    Typography,
    Button,
    InputComponent,
    Switch,
    TranslatePipe,
  ],
})
export class BookingSlotFormModal implements OnChanges, OnDestroy {
  @Input() isOpen = false;
  @Input() editingSlot: BookingSlot | null = null;
  // Prefill from a calendar selection: the dragged day is enabled and its
  // hours become the slot boundaries.
  @Input() initialStartDate: Date | null = null;
  @Input() initialEndDate: Date | null = null;

  @Output() closed = new EventEmitter<void>();
  @Output() slotSaved = new EventEmitter<void>();
  @Output() slotDeleted = new EventEmitter<void>();

  private destroy$ = new Subject<void>();
  private fb = inject(FormBuilder);
  private consultationService = inject(ConsultationService);
  private toasterService = inject(ToasterService);
  private validationService = inject(ValidationService);
  private confirmationService = inject(ConfirmationService);
  private logger = inject(LoggerService);
  private t = inject(TranslationService);

  isSaving = signal(false);
  slotForm: FormGroup;
  weekDays = WEEK_DAYS;

  protected readonly TypographyTypeEnum = TypographyTypeEnum;
  protected readonly ButtonSizeEnum = ButtonSizeEnum;
  protected readonly ButtonStyleEnum = ButtonStyleEnum;
  protected readonly ButtonStateEnum = ButtonStateEnum;

  constructor() {
    this.slotForm = this.fb.group({
      start_time: ['09:00', [Validators.required]],
      end_time: ['17:00', [Validators.required]],
      start_break: [''],
      end_break: [''],
      monday: [false],
      tuesday: [false],
      wednesday: [false],
      thursday: [false],
      friday: [false],
      saturday: [false],
      sunday: [false],
      valid_until: [''],
    });
  }

  ngOnChanges(changes: SimpleChanges): void {
    // Reset the form on every opening so a previous edit never leaks into the
    // next one.
    if (changes['isOpen'] && this.isOpen) {
      this.resetForm();
    }
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  get isEditing(): boolean {
    return !!this.editingSlot;
  }

  get modalTitle(): string {
    return this.isEditing
      ? this.t.instant('configuration.editTimeSlot')
      : this.t.instant('configuration.createNewSlot');
  }

  private resetForm(): void {
    const slot = this.editingSlot;
    if (slot) {
      this.slotForm.reset({
        start_time: this.toTimeInput(slot.start_time),
        end_time: this.toTimeInput(slot.end_time),
        start_break: slot.start_break ? this.toTimeInput(slot.start_break) : '',
        end_break: slot.end_break ? this.toTimeInput(slot.end_break) : '',
        monday: slot.monday,
        tuesday: slot.tuesday,
        wednesday: slot.wednesday,
        thursday: slot.thursday,
        friday: slot.friday,
        saturday: slot.saturday,
        sunday: slot.sunday,
        valid_until: slot.valid_until || '',
      });
      return;
    }

    const start = this.initialStartDate;
    const end = this.initialEndDate;
    const days: Record<string, boolean> = {};
    DAY_KEYS.forEach(key => (days[key] = false));
    if (start) {
      days[DAY_KEYS[start.getDay()]] = true;
    }

    this.slotForm.reset({
      start_time: start ? this.toClockTime(start) : '09:00',
      end_time: end ? this.toClockTime(end) : '17:00',
      start_break: '',
      end_break: '',
      ...days,
      valid_until: '',
    });
  }

  onClose(): void {
    this.closed.emit();
  }

  save(): void {
    if (!this.slotForm.valid) {
      this.validationService.validateAllFormFields(this.slotForm);
      this.toasterService.show(
        'error',
        this.t.instant('configuration.validationError'),
        this.t.instant('configuration.fillRequiredFields')
      );
      return;
    }

    const value = this.slotForm.value;
    const payload: CreateBookingSlot = {
      start_time: value.start_time,
      end_time: value.end_time,
      start_break: value.start_break || null,
      end_break: value.end_break || null,
      monday: !!value.monday,
      tuesday: !!value.tuesday,
      wednesday: !!value.wednesday,
      thursday: !!value.thursday,
      friday: !!value.friday,
      saturday: !!value.saturday,
      sunday: !!value.sunday,
      valid_until: value.valid_until || null,
    };

    const editing = this.editingSlot;
    this.isSaving.set(true);
    const request = editing
      ? this.consultationService.updateBookingSlot(editing.id, payload)
      : this.consultationService.createBookingSlot(payload);

    request.pipe(takeUntil(this.destroy$)).subscribe({
      next: () => {
        this.isSaving.set(false);
        this.toasterService.show(
          'success',
          this.t.instant(
            editing ? 'configuration.slotUpdated' : 'configuration.slotCreated'
          ),
          this.t.instant(
            editing
              ? 'configuration.slotUpdatedMessage'
              : 'configuration.slotCreatedMessage'
          )
        );
        this.slotSaved.emit();
        this.onClose();
      },
      error: error => {
        this.isSaving.set(false);
        this.logger.error('Error saving booking slot:', error);
        this.toasterService.show(
          'error',
          this.t.instant('configuration.errorSavingSlot'),
          getErrorMessage(error)
        );
      },
    });
  }

  async confirmDelete(): Promise<void> {
    const slot = this.editingSlot;
    if (!slot) {
      return;
    }

    const confirmed = await this.confirmationService.confirm({
      title: this.t.instant('configuration.deleteSlotTitle'),
      message: this.t.instant('configuration.deleteSlotMessage'),
      confirmText: this.t.instant('configuration.deleteConfirm'),
      cancelText: this.t.instant('configuration.deleteCancel'),
      confirmStyle: 'danger',
    });
    if (!confirmed) {
      return;
    }

    this.consultationService
      .deleteBookingSlot(slot.id)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: () => {
          this.toasterService.show(
            'success',
            this.t.instant('configuration.slotDeleted'),
            this.t.instant('configuration.slotDeletedMessage')
          );
          this.slotDeleted.emit();
          this.onClose();
        },
        error: error => {
          this.logger.error('Error deleting booking slot:', error);
          this.toasterService.show(
            'error',
            this.t.instant('configuration.errorDeletingSlot'),
            getErrorMessage(error)
          );
        },
      });
  }

  isFieldInvalid(fieldName: string): boolean {
    return this.validationService.showError(this.slotForm, fieldName);
  }

  getFieldError(fieldName: string): string {
    const field = this.slotForm.get(fieldName);
    if (field?.errors?.['required'] && field.touched) {
      return this.t.instant('slotModal.fieldRequired', { field: fieldName });
    }
    return '';
  }

  /** "09:00:00" (API) -> "09:00" (<input type="time">). */
  private toTimeInput(time: string): string {
    return time.substring(0, 5);
  }

  private toClockTime(date: Date): string {
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    return `${hours}:${minutes}`;
  }
}
