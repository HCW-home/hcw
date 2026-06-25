import {
  Input,
  Output,
  inject,
  Component,
  ViewChild,
  EventEmitter,
} from '@angular/core';
import { CommonModule } from '@angular/common';

import { Reminder } from '../../../core/models/reminder';
import { IUser } from '../../../modules/user/models/user';
import { ModalComponent } from '../modal/modal.component';
import { ReminderForm } from '../reminder-form/reminder-form';
import { TranslationService } from '../../../core/services/translation.service';

@Component({
  selector: 'app-reminder-form-modal',
  templateUrl: './reminder-form-modal.html',
  imports: [CommonModule, ModalComponent, ReminderForm],
})
export class ReminderFormModal {
  private t = inject(TranslationService);

  @Input() isOpen = false;
  @Input() consultationId?: number;
  @Input() editingReminder: Reminder | null = null;
  @Input() initialRecipient: IUser | null = null;

  @Output() closed = new EventEmitter<void>();
  @Output() reminderCreated = new EventEmitter<Reminder>();
  @Output() reminderUpdated = new EventEmitter<Reminder>();

  @ViewChild(ReminderForm) reminderForm!: ReminderForm;

  get modalTitle(): string {
    return this.editingReminder
      ? this.t.instant('reminders.editReminder')
      : this.t.instant('reminders.newReminder');
  }

  onClose(): void {
    if (this.reminderForm) {
      this.reminderForm.resetForm();
    }
    this.closed.emit();
  }

  onReminderCreated(reminder: Reminder): void {
    this.reminderCreated.emit(reminder);
    this.onClose();
  }

  onReminderUpdated(reminder: Reminder): void {
    this.reminderUpdated.emit(reminder);
    this.onClose();
  }
}
