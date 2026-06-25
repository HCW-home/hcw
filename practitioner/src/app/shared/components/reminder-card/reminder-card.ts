import {
  Input,
  inject,
  Output,
  Component,
  EventEmitter,
} from '@angular/core';
import { CommonModule } from '@angular/common';

import { Reminder } from '../../../core/models/reminder';
import { Button } from '../../ui-components/button/button';
import {
  ButtonStyleEnum,
  ButtonSizeEnum,
  ButtonStateEnum,
} from '../../constants/button';
import { LocalDatePipe } from '../../pipes/local-date.pipe';
import { TranslatePipe } from '@ngx-translate/core';
import { TranslationService } from '../../../core/services/translation.service';

@Component({
  selector: 'app-reminder-card',
  templateUrl: './reminder-card.html',
  styleUrl: './reminder-card.scss',
  imports: [CommonModule, Button, LocalDatePipe, TranslatePipe],
})
export class ReminderCard {
  private t = inject(TranslationService);

  @Input({ required: true }) reminder!: Reminder;
  @Input() showActions = true;

  @Output() edit = new EventEmitter<Reminder>();
  @Output() delete = new EventEmitter<Reminder>();

  protected readonly ButtonStyleEnum = ButtonStyleEnum;
  protected readonly ButtonSizeEnum = ButtonSizeEnum;
  protected readonly ButtonStateEnum = ButtonStateEnum;

  get recipientName(): string {
    const u = this.reminder.recipient;
    if (!u) return '';
    return `${u.first_name || ''} ${u.last_name || ''}`.trim() || u.email || '';
  }

  get recurrenceLabel(): string {
    const r = this.reminder;
    if (!r.is_recurring || !r.recurrence_period) return '';
    const period = this.t.instant(`reminders.${r.recurrence_period}`);
    return this.t.instant('reminders.recurrenceSummary', {
      interval: String(r.recurrence_interval),
      period,
      count: String(r.recurrence_count),
    });
  }
}
