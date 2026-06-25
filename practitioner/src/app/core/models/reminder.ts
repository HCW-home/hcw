import { User } from './consultation';

export type RecurrencePeriod = 'day' | 'week' | 'month';

export interface Reminder {
  id: number;
  title: string;
  description: string;
  consultation: number | null;
  recipient: User;
  created_by: User;
  scheduled_at: string;
  is_recurring: boolean;
  recurrence_interval: number;
  recurrence_period: RecurrencePeriod | '';
  recurrence_count: number;
  occurrences_sent: number;
  next_run_at: string | null;
  last_sent_at: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface CreateReminderRequest {
  title: string;
  description?: string;
  recipient_id: number;
  consultation_id?: number;
  scheduled_at: string;
  is_recurring: boolean;
  recurrence_interval?: number;
  recurrence_period?: RecurrencePeriod;
  recurrence_count?: number;
}

export interface ReminderOccurrence {
  reminder_id: number;
  title: string;
  description: string;
  recipient: User;
  consultation: number | null;
  is_recurring: boolean;
  occurrence_index: number;
  occurrence_total: number;
  occurrence_at: string;
}
