import { Injectable } from '@angular/core';
import { Observable, BehaviorSubject } from 'rxjs';
import { tap } from 'rxjs/operators';
import { ApiService, PaginatedResponse } from './api.service';

export interface Notification {
  id: number;
  title: string;
  message: string;
  content?: string;
  subject?: string;
  communication_method?: string;
  status: 'delivered' | 'sent' | 'pending' | 'failed' | 'read';
  sent_at?: string;
  created_at: string;
  is_read?: boolean;
  type?: 'appointment' | 'message' | 'health' | 'system';
}

export interface NotificationFilters {
  page?: number;
  limit?: number;
  status?: string;
}

@Injectable({
  providedIn: 'root'
})
export class NotificationService {
  private unreadCountSubject = new BehaviorSubject<number>(0);
  public unreadCount$ = this.unreadCountSubject.asObservable();

  constructor(private api: ApiService) {}

  getNotifications(filters?: NotificationFilters): Observable<PaginatedResponse<Notification>> {
    return this.api.get<PaginatedResponse<Notification>>('/user/notifications/', filters).pipe(
      tap(response => {
        const unread = response.results.filter(n => n.status !== 'read').length;
        this.unreadCountSubject.next(unread);
      })
    );
  }

  markAsRead(id: number): Observable<Notification> {
    return this.api.patch<Notification>(`/user/notifications/${id}/`, { status: 'read' }).pipe(
      tap(() => {
        const current = this.unreadCountSubject.value;
        if (current > 0) {
          this.unreadCountSubject.next(current - 1);
        }
      })
    );
  }

  markAllAsRead(): Observable<void> {
    return this.api.post<void>('/user/notifications/mark-all-read/', {}).pipe(
      tap(() => this.unreadCountSubject.next(0))
    );
  }

  deleteNotification(id: number): Observable<void> {
    return this.api.delete<void>(`/user/notifications/${id}/`);
  }

  updateUnreadCount(count: number): void {
    this.unreadCountSubject.next(count);
  }
}
