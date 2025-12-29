import { Injectable } from '@angular/core';
import { Observable, BehaviorSubject } from 'rxjs';
import { tap } from 'rxjs/operators';
import { ApiService, PaginatedResponse } from './api.service';
import { INotification, INotificationResponse, NotificationFilters, NotificationStatus } from '../models/notification.model';

@Injectable({
  providedIn: 'root'
})
export class NotificationService {
  private unreadCountSubject = new BehaviorSubject<number>(0);
  public unreadCount$ = this.unreadCountSubject.asObservable();

  constructor(private api: ApiService) {}

  getNotifications(filters?: NotificationFilters): Observable<INotificationResponse> {
    return this.api.get<INotificationResponse>('/user/notifications/', filters).pipe(
      tap(response => {
        const unread = response.results.filter(n => n.status !== NotificationStatus.READ).length;
        this.unreadCountSubject.next(unread);
      })
    );
  }

  markAsRead(id: number): Observable<INotification> {
    return this.api.post<INotification>(`/user/notifications/${id}/read/`, {}).pipe(
      tap(() => {
        const current = this.unreadCountSubject.value;
        if (current > 0) {
          this.unreadCountSubject.next(current - 1);
        }
      })
    );
  }

  markAllAsRead(): Observable<{ detail: string; updated_count: number }> {
    return this.api.post<{ detail: string; updated_count: number }>('/user/notifications/read/', {}).pipe(
      tap(() => this.unreadCountSubject.next(0))
    );
  }

  updateUnreadCount(count: number): void {
    this.unreadCountSubject.next(count);
  }
}
