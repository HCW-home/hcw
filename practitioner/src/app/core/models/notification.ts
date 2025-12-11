export enum NotificationStatus {
  PENDING = 'pending',
  SENT = 'sent',
  DELIVERED = 'delivered',
  FAILED = 'failed',
  READ = 'read'
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
  created_at: string;
}

export interface INotificationResponse {
  count: number;
  next: string | null;
  previous: string | null;
  results: INotification[];
}
