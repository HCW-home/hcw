export enum NotificationStatus {
  PENDING = 'pending',
  SENT = 'sent',
  DELIVERED = 'delivered',
  FAILED = 'failed',
  READ = 'read'
}

export interface INotificationSender {
  id: number;
  email: string;
  first_name: string;
  last_name: string;
}

export interface INotification {
  id: number;
  content: string;
  subject: string;
  communication_method: string;
  status: NotificationStatus;
  sent_at: string | null;
  delivered_at: string | null;
  read_at: string | null;
  failed_at: string | null;
  created_at: string;
  updated_at: string;
  sent_by: INotificationSender | null;
  object_model: string | null;
  object_pk: number | null;
  access_link: string | null;
  action_label: string | null;
}

export interface INotificationResponse {
  count: number;
  next: string | null;
  previous: string | null;
  results: INotification[];
}
