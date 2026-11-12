import { Injectable, inject, signal } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable, tap } from 'rxjs';
import { environment } from '../../../environments/environment';
import { INotification, INotificationResponse, NotificationStatus } from '../models/notification';
import { NotificationEvent } from '../models/websocket';

@Injectable({
  providedIn: 'root'
})
export class NotificationService {
  private http = inject(HttpClient);
  private apiUrl = `${environment.apiUrl}/user/notifications/`;
  private currentPage = 1;
  private pageSize = 10;

  notifications = signal<INotification[]>([]);
  unreadCount = signal<number>(0);
  isLoading = signal<boolean>(false);
  isLoadingMore = signal<boolean>(false);
  hasMore = signal<boolean>(false);

  getNotifications(params?: {
    status?: NotificationStatus;
    page?: number;
    page_size?: number;
  }): Observable<INotificationResponse> {
    let httpParams = new HttpParams();

    if (params?.status) {
      httpParams = httpParams.set('status', params.status);
    }
    if (params?.page) {
      httpParams = httpParams.set('page', params.page.toString());
    }
    if (params?.page_size) {
      httpParams = httpParams.set('page_size', params.page_size.toString());
    }

    return this.http.get<INotificationResponse>(this.apiUrl, { params: httpParams });
  }

  loadNotifications(): void {
    this.isLoading.set(true);
    this.currentPage = 1;
    this.getNotifications({ page: 1, page_size: this.pageSize }).subscribe({
      next: (response) => {
        this.notifications.set(response.results);
        this.updateUnreadCount(response.results);
        this.hasMore.set(response.next !== null);
        this.isLoading.set(false);
      },
      error: () => {
        this.isLoading.set(false);
      }
    });
  }

  loadMore(): void {
    if (this.isLoadingMore() || !this.hasMore()) return;

    this.isLoadingMore.set(true);
    this.currentPage++;

    this.getNotifications({ page: this.currentPage, page_size: this.pageSize }).subscribe({
      next: (response) => {
        const current = this.notifications();
        this.notifications.set([...current, ...response.results]);
        this.hasMore.set(response.next !== null);
        this.isLoadingMore.set(false);
      },
      error: () => {
        this.currentPage--;
        this.isLoadingMore.set(false);
      }
    });
  }

  private updateUnreadCount(notifications: INotification[]): void {
    const unread = notifications.filter(n =>
      n.status !== NotificationStatus.READ && n.read_at === null
    ).length;
    this.unreadCount.set(unread);
  }

  markAsRead(notificationId: number): Observable<INotification> {
    return this.http.post<INotification>(`${this.apiUrl}${notificationId}/read/`, {}).pipe(
      tap((response) => {
        const current = this.notifications();
        const updated = current.map(n =>
          n.id === notificationId ? { ...n, status: NotificationStatus.READ, read_at: response.read_at } : n
        );
        this.notifications.set(updated);
        this.updateUnreadCount(updated);
      })
    );
  }

  markAllAsRead(): Observable<{ detail: string; updated_count: number }> {
    return this.http.post<{ detail: string; updated_count: number }>(`${this.apiUrl}read/`, {}).pipe(
      tap(() => {
        const current = this.notifications();
        const now = new Date().toISOString();
        const updated = current.map(n => ({ ...n, status: NotificationStatus.READ, read_at: now }));
        this.notifications.set(updated);
        this.unreadCount.set(0);
      })
    );
  }

  handleWebSocketNotification(event: NotificationEvent): void {
    console.log('[NotificationService] Handling WS notification:', event);
    const notification: INotification = {
      id: event.id ?? Date.now(),
      content: event.render_content_html,
      subject: event.render_subject,
      communication_method: 'websocket',
      status: NotificationStatus.DELIVERED,
      sent_at: event.created_at,
      delivered_at: event.created_at,
      read_at: null,
      failed_at: null,
      created_at: event.created_at,
      updated_at: event.created_at,
      sent_by: null,
      object_model: null,
      object_pk: null,
      access_link: event.access_link,
      action_label: event.action_label,
    };

    const current = this.notifications();
    this.notifications.set([notification, ...current]);
    this.unreadCount.update(count => count + 1);
    console.log('[NotificationService] Notifications count:', this.notifications().length, 'Unread:', this.unreadCount());
  }

  getRelativeTime(dateStr: string): string {
    const date = new Date(dateStr);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / (1000 * 60));
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

    if (diffMins < 1) {
      return 'Just now';
    } else if (diffMins < 60) {
      return `${diffMins}m ago`;
    } else if (diffHours < 24) {
      return `${diffHours}h ago`;
    } else if (diffDays === 1) {
      return 'Yesterday';
    } else if (diffDays < 7) {
      return `${diffDays}d ago`;
    } else {
      return date.toLocaleDateString();
    }
  }
}
