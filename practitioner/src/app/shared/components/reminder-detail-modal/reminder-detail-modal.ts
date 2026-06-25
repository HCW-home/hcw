import {
  Input,
  inject,
  Output,
  Component,
  EventEmitter,
} from '@angular/core';
import { CommonModule } from '@angular/common';

import { Reminder } from '../../../core/models/reminder';
import { ModalComponent } from '../modal/modal.component';
import { Button } from '../../ui-components/button/button';
import { Svg } from '../../ui-components/svg/svg';
import {
  ButtonStyleEnum,
  ButtonSizeEnum,
  ButtonStateEnum,
} from '../../constants/button';
import { LocalDatePipe } from '../../pipes/local-date.pipe';
import { TranslatePipe } from '@ngx-translate/core';
import { TranslationService } from '../../../core/services/translation.service';

@Component({
  selector: 'app-reminder-detail-modal',
  templateUrl: './reminder-detail-modal.html',
  styleUrl: './reminder-detail-modal.scss',
  imports: [CommonModule, ModalComponent, Button, Svg, LocalDatePipe, TranslatePipe],
})
export class ReminderDetailModal {
  private t = inject(TranslationService);

  @Input() isOpen = false;
  @Input() reminder: Reminder | null = null;

  @Output() closed = new EventEmitter<void>();
  @Output() edit = new EventEmitter<Reminder>();
  @Output() delete = new EventEmitter<Reminder>();

  protected readonly ButtonStyleEnum = ButtonStyleEnum;
  protected readonly ButtonSizeEnum = ButtonSizeEnum;
  protected readonly ButtonStateEnum = ButtonStateEnum;

  get recipientName(): string {
    const u = this.reminder?.recipient;
    if (!u) return '';
    return `${u.first_name || ''} ${u.last_name || ''}`.trim() || u.email || '';
  }

  get recurrenceLabel(): string {
    const r = this.reminder;
    if (!r || !r.is_recurring || !r.recurrence_period) return '';
    const period = this.t.instant(`reminders.${r.recurrence_period}`);
    return this.t.instant('reminders.recurrenceSummary', {
      interval: String(r.recurrence_interval),
      period,
      count: String(r.recurrence_count),
    });
  }

  onClose(): void {
    this.closed.emit();
  }

  onEdit(): void {
    if (this.reminder) this.edit.emit(this.reminder);
  }

  onDelete(): void {
    if (this.reminder) this.delete.emit(this.reminder);
  }
}
