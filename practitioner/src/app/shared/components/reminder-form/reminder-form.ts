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
import { Reminder, CreateReminderRequest } from '../../../core/models/reminder';
import { IUser } from '../../../modules/user/models/user';

import { Button } from '../../ui-components/button/button';
import { Input as InputComponent } from '../../ui-components/input/input';
import { Textarea } from '../../ui-components/textarea/textarea';
import { Select } from '../../ui-components/select/select';
import { Checkbox } from '../../ui-components/checkbox/checkbox';
import { UserSearchSelect } from '../user-search-select/user-search-select';
import { ButtonStyleEnum, ButtonSizeEnum } from '../../constants/button';
import { SelectOption } from '../../models/select';
import { extractDateFromISO, extractTimeFromISO } from '../../tools/helper';
import { getErrorMessage } from '../../../core/utils/error-helper';
import { TranslatePipe } from '@ngx-translate/core';
import { TranslationService } from '../../../core/services/translation.service';

@Component({
  selector: 'app-reminder-form',
  templateUrl: './reminder-form.html',
  styleUrl: './reminder-form.scss',
  imports: [
    Select,
    Button,
    Checkbox,
    Textarea,
    CommonModule,
    InputComponent,
    UserSearchSelect,
    ReactiveFormsModule,
    FormsModule,
    TranslatePipe,
  ],
})
export class ReminderForm implements OnInit, OnChanges, OnDestroy {
  @Input() consultationId?: number;
  @Input() editingReminder: Reminder | null = null;
  @Input() initialRecipient: IUser | null = null;
  @Input() initialDate: Date | null = null;
  // Lock the recipient field (e.g. when creating from a contact page, the
  // reminder is necessarily for that contact).
  @Input() lockRecipient = false;

  @Output() cancelled = new EventEmitter<void>();
  @Output() reminderCreated = new EventEmitter<Reminder>();
  @Output() reminderUpdated = new EventEmitter<Reminder>();

  private destroy$ = new Subject<void>();
  private fb = inject(FormBuilder);
  private consultationService = inject(ConsultationService);
  private toasterService = inject(ToasterService);
  private userService = inject(UserService);
  private t = inject(TranslationService);

  isSubmitting = signal(false);
  currentUser = signal<IUser | null>(null);
  selectedRecipient = signal<IUser | null>(null);
  // Stable reference for the search-select initial value: computed once so it
  // does not re-trigger the select's effect (which would re-impose the
  // recipient after the user clears it).
  displayRecipient: IUser | null = null;
  reminderForm!: FormGroup;
  backendErrors = signal<Record<string, string[]>>({});

  protected readonly ButtonStyleEnum = ButtonStyleEnum;
  protected readonly ButtonSizeEnum = ButtonSizeEnum;

  get periodOptions(): SelectOption[] {
    return [
      { value: 'day', label: this.t.instant('reminders.day') },
      { value: 'week', label: this.t.instant('reminders.week') },
      { value: 'month', label: this.t.instant('reminders.month') },
    ];
  }

  get isRecurring(): boolean {
    return !!this.reminderForm?.get('is_recurring')?.value;
  }

  get isEditMode(): boolean {
    return this.editingReminder !== null;
  }

  // Recipient to pre-fill the search-select: the edited reminder's recipient
  // takes precedence, otherwise the recipient provided on creation. Computed
  // once (see ngOnInit) to keep a stable object reference.
  private computeDisplayRecipient(): IUser | null {
    const r = this.editingReminder?.recipient;
    if (r) {
      return {
        pk: r.id,
        email: r.email,
        first_name: r.first_name,
        last_name: r.last_name,
        picture: r.picture,
      } as IUser;
    }
    return this.initialRecipient;
  }

  get lockedRecipientName(): string {
    const u = this.displayRecipient;
    if (!u) return '';
    return `${u.first_name || ''} ${u.last_name || ''}`.trim() || u.email || '';
  }

  ngOnInit(): void {
    this.initForm();
    this.loadCurrentUser();
    this.displayRecipient = this.computeDisplayRecipient();

    if (this.editingReminder) {
      this.populateFormForEdit();
    } else {
      if (this.initialRecipient) {
        this.reminderForm.patchValue({ recipient_id: this.initialRecipient.pk });
      }
      if (this.initialDate) {
        const d = this.initialDate;
        const pad = (n: number) => String(n).padStart(2, '0');
        this.reminderForm.patchValue({
          date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
          time: `${pad(d.getHours())}:${pad(d.getMinutes())}`,
        });
      }
    }

    this.reminderForm.valueChanges
      .pipe(takeUntil(this.destroy$))
      .subscribe(() => {
        if (Object.keys(this.backendErrors()).length > 0) {
          this.backendErrors.set({});
        }
      });
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['editingReminder'] && this.reminderForm) {
      if (this.editingReminder) {
        this.populateFormForEdit();
      } else {
        this.resetForm();
      }
    }
  }

  private populateFormForEdit(): void {
    const r = this.editingReminder;
    if (!r) return;
    this.selectedRecipient.set(null);
    this.reminderForm.patchValue({
      recipient_id: r.recipient?.id ?? null,
      title: r.title,
      description: r.description || '',
      date: extractDateFromISO(r.scheduled_at),
      time: extractTimeFromISO(r.scheduled_at),
      is_recurring: r.is_recurring,
      recurrence_interval: r.recurrence_interval || 1,
      recurrence_period: r.recurrence_period || 'day',
      recurrence_count: r.recurrence_count || 5,
    });
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  private initForm(): void {
    this.reminderForm = this.fb.group({
      recipient_id: [null, [Validators.required]],
      title: ['', [Validators.required]],
      description: [''],
      date: ['', [Validators.required]],
      time: ['', [Validators.required]],
      is_recurring: [false],
      recurrence_interval: [1],
      recurrence_period: ['day'],
      recurrence_count: [5],
    });
  }

  private loadCurrentUser(): void {
    this.userService.currentUser$
      .pipe(takeUntil(this.destroy$))
      .subscribe(user => this.currentUser.set(user));
    if (!this.currentUser()) {
      this.userService.getCurrentUser().pipe(takeUntil(this.destroy$)).subscribe();
    }
  }

  onRecipientSelected(user: IUser | null): void {
    this.selectedRecipient.set(user);
    this.reminderForm.patchValue({ recipient_id: user ? user.pk : null });
  }

  getFieldError(fieldName: string): string {
    const errors = this.backendErrors();
    if (errors[fieldName] && errors[fieldName].length > 0) {
      return errors[fieldName][0];
    }
    const control = this.reminderForm.get(fieldName);
    if (control && control.invalid && control.touched) {
      if (control.hasError('required')) {
        return this.t.instant('reminders.fieldRequired');
      }
    }
    return '';
  }

  resetForm(): void {
    this.reminderForm.reset({
      recipient_id: null,
      is_recurring: false,
      recurrence_interval: 1,
      recurrence_period: 'day',
      recurrence_count: 5,
    });
    this.selectedRecipient.set(null);
    this.backendErrors.set({});
  }

  onCancel(): void {
    this.cancelled.emit();
  }

  submit(): void {
    Object.keys(this.reminderForm.controls).forEach(key => {
      this.reminderForm.get(key)?.markAsTouched();
    });

    if (!this.reminderForm.valid) return;

    const formValue = this.reminderForm.value;
    const scheduledAt = `${formValue.date}T${formValue.time}`;

    const scheduledDate = new Date(scheduledAt);
    if (scheduledDate < new Date()) {
      this.backendErrors.set({
        date: [this.t.instant('reminders.scheduledInPast')],
        time: [this.t.instant('reminders.scheduledInPast')],
      });
      return;
    }

    const data: CreateReminderRequest = {
      title: formValue.title,
      description: formValue.description || undefined,
      recipient_id: formValue.recipient_id,
      consultation_id: this.consultationId,
      scheduled_at: scheduledAt,
      is_recurring: !!formValue.is_recurring,
    };

    if (formValue.is_recurring) {
      data.recurrence_interval = formValue.recurrence_interval || 1;
      data.recurrence_period = formValue.recurrence_period;
      data.recurrence_count = formValue.recurrence_count || 1;
    }

    this.isSubmitting.set(true);
    this.backendErrors.set({});

    const request$ =
      this.isEditMode && this.editingReminder
        ? this.consultationService.updateReminder(this.editingReminder.id, data)
        : this.consultationService.createReminder(data);

    request$.pipe(takeUntil(this.destroy$)).subscribe({
      next: reminder => {
        this.isSubmitting.set(false);
        if (this.isEditMode) {
          this.toasterService.show(
            'success',
            this.t.instant('reminders.updated')
          );
          this.reminderUpdated.emit(reminder);
        } else {
          this.toasterService.show(
            'success',
            this.t.instant('reminders.created'),
            this.t.instant('reminders.createdMessage')
          );
          this.reminderCreated.emit(reminder);
        }
      },
      error: error => {
        this.isSubmitting.set(false);
        if (error.status === 400 && error.error) {
          const backendErrors = error.error as Record<string, string[]>;
          const mappedErrors: Record<string, string[]> = {};
          if (backendErrors['scheduled_at']) {
            mappedErrors['date'] = backendErrors['scheduled_at'];
            mappedErrors['time'] = backendErrors['scheduled_at'];
          }
          Object.keys(backendErrors).forEach(key => {
            if (key !== 'scheduled_at') {
              mappedErrors[key] = backendErrors[key];
            }
          });
          this.backendErrors.set(mappedErrors);
        } else {
          this.toasterService.show(
            'error',
            this.isEditMode
              ? this.t.instant('reminders.errorUpdating')
              : this.t.instant('reminders.errorCreating'),
            getErrorMessage(error)
          );
        }
      },
    });
  }
}
