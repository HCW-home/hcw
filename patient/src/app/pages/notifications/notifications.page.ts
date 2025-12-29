import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import {
  IonHeader,
  IonToolbar,
  IonTitle,
  IonButtons,
  IonButton,
  IonText,
  IonLabel,
  IonContent,
  IonRefresher,
  IonRefresherContent,
  IonList,
  IonItemSliding,
  IonItem,
  IonIcon,
  IonItemOptions,
  IonItemOption,
  NavController,
  ToastController
} from '@ionic/angular/standalone';
import { Subscription } from 'rxjs';
import { NotificationService } from '../../core/services/notification.service';
import { INotification, NotificationStatus } from '../../core/models/notification.model';
import { UserWebSocketService } from '../../core/services/user-websocket.service';

interface DisplayNotification {
  id: number;
  title: string;
  message: string;
  icon: string;
  color: string;
  time: string;
  isRead: boolean;
  type: 'appointment' | 'message' | 'health' | 'system';
}

@Component({
  selector: 'app-notifications',
  templateUrl: './notifications.page.html',
  styleUrls: ['./notifications.page.scss'],
  standalone: true,
  imports: [
    CommonModule,
    IonHeader,
    IonToolbar,
    IonTitle,
    IonButtons,
    IonButton,
    IonText,
    IonLabel,
    IonContent,
    IonRefresher,
    IonRefresherContent,
    IonList,
    IonItemSliding,
    IonItem,
    IonIcon,
    IonItemOptions,
    IonItemOption
  ]
})
export class NotificationsPage implements OnInit, OnDestroy {
  notifications: DisplayNotification[] = [];
  isLoading = true;
  private subscriptions: Subscription[] = [];

  constructor(
    private navCtrl: NavController,
    private toastCtrl: ToastController,
    private notificationService: NotificationService,
    private userWs: UserWebSocketService
  ) {}

  ngOnInit() {
    this.loadNotifications();
    this.setupRealtimeNotifications();
  }

  ngOnDestroy() {
    this.subscriptions.forEach(sub => sub.unsubscribe());
  }

  loadNotifications(event?: { target: { complete: () => void } }): void {
    this.isLoading = !event;
    this.notificationService.getNotifications().subscribe({
      next: (response) => {
        this.notifications = response.results.map(n => this.mapNotification(n));
        this.isLoading = false;
        event?.target.complete();
      },
      error: () => {
        this.isLoading = false;
        event?.target.complete();
      }
    });
  }

  private setupRealtimeNotifications(): void {
    const sub = this.userWs.notifications$.subscribe(event => {
      const data = event.data;
      const notification: INotification = {
        id: Date.now(),
        subject: (data['title'] as string) || 'New Notification',
        content: (data['message'] as string) || '',
        communication_method: 'push',
        status: NotificationStatus.PENDING,
        sent_at: null,
        delivered_at: null,
        read_at: null,
        created_at: new Date().toISOString()
      };
      this.notifications.unshift(this.mapNotification(notification));
    });
    this.subscriptions.push(sub);
  }

  private mapNotification(n: INotification): DisplayNotification {
    const type = this.determineType(n);
    return {
      id: n.id,
      title: n.subject || 'Notification',
      message: n.content || '',
      icon: this.getIconForType(type),
      color: this.getColorForType(type),
      time: this.formatTime(n.created_at),
      isRead: n.status === NotificationStatus.READ,
      type
    };
  }

  private determineType(n: INotification): 'appointment' | 'message' | 'health' | 'system' {
    const title = (n.subject || '').toLowerCase();
    if (title.includes('appointment') || title.includes('schedule')) {
      return 'appointment';
    } else if (title.includes('message')) {
      return 'message';
    } else if (title.includes('health') || title.includes('test') || title.includes('prescription')) {
      return 'health';
    }
    return 'system';
  }

  private getIconForType(type: string): string {
    switch (type) {
      case 'appointment': return 'calendar';
      case 'message': return 'mail';
      case 'health': return 'medkit';
      default: return 'information-circle';
    }
  }

  private getColorForType(type: string): string {
    switch (type) {
      case 'appointment': return 'primary';
      case 'message': return 'secondary';
      case 'health': return 'success';
      default: return 'warning';
    }
  }

  private formatTime(dateString: string): string {
    const date = new Date(dateString);
    const now = new Date();
    const diff = now.getTime() - date.getTime();
    const minutes = Math.floor(diff / (1000 * 60));
    const hours = Math.floor(diff / (1000 * 60 * 60));
    const days = Math.floor(diff / (1000 * 60 * 60 * 24));

    if (minutes < 1) return 'Just now';
    if (minutes < 60) return `${minutes} min ago`;
    if (hours < 24) return `${hours} hour${hours > 1 ? 's' : ''} ago`;
    if (days === 1) return 'Yesterday';
    if (days < 7) return `${days} days ago`;
    return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
  }

  openNotificationSettings() {
    this.navCtrl.navigateForward('/notification-settings');
  }

  async markAllAsRead() {
    const unreadNotifications = this.notifications.filter(n => !n.isRead);
    if (unreadNotifications.length === 0) {
      return;
    }

    this.notifications.forEach(n => n.isRead = true);
    this.notificationService.markAllAsRead().subscribe({
      next: async () => {
        const toast = await this.toastCtrl.create({
          message: 'All notifications marked as read',
          duration: 2000,
          position: 'top',
          color: 'success'
        });
        await toast.present();
      },
      error: async () => {
        const toast = await this.toastCtrl.create({
          message: 'Failed to mark notifications as read',
          duration: 2000,
          position: 'top',
          color: 'danger'
        });
        await toast.present();
      }
    });
  }

  dismissNotification(notification: DisplayNotification) {
    const index = this.notifications.indexOf(notification);
    if (index > -1) {
      this.notifications.splice(index, 1);
    }
  }

  refreshNotifications(event: { target: { complete: () => void } }) {
    this.loadNotifications(event);
  }
}
