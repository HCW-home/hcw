import { Injectable } from '@angular/core';
import { BehaviorSubject } from 'rxjs';
import { Capacitor } from '@capacitor/core';
import { ApiService } from './api.service';

export interface PushNotificationData {
  id?: string;
  title: string;
  body: string;
  data?: Record<string, unknown>;
  actionId?: string;
}

@Injectable({
  providedIn: 'root'
})
export class PushNotificationService {
  private tokenSubject = new BehaviorSubject<string | null>(null);
  public token$ = this.tokenSubject.asObservable();

  private notificationSubject = new BehaviorSubject<PushNotificationData | null>(null);
  public notification$ = this.notificationSubject.asObservable();

  private permissionGranted = false;
  private isInitialized = false;
  private isNativePlatform = false;

  constructor(private api: ApiService) {
    this.isNativePlatform = Capacitor.getPlatform() !== 'web';
  }

  async initialize(): Promise<void> {
    if (this.isInitialized) return;

    if (!this.isNativePlatform) {
      await this.initializeWeb();
    }

    this.isInitialized = true;
  }

  private async initializeWeb(): Promise<void> {
    if (typeof window === 'undefined' || !('Notification' in window)) {
      return;
    }

    try {
      const permission = Notification.permission;
      this.permissionGranted = permission === 'granted';

      if (this.permissionGranted && 'serviceWorker' in navigator) {
        const registration = await navigator.serviceWorker.ready;
        if ('pushManager' in registration) {
          const subscription = await registration.pushManager.getSubscription();
          if (subscription) {
            this.tokenSubject.next(JSON.stringify(subscription));
          }
        }
      }
    } catch (error) {
      console.warn('Failed to initialize web push');
    }
  }

  async requestPermission(): Promise<boolean> {
    if (this.isNativePlatform) {
      return false;
    }

    if (typeof window === 'undefined' || !('Notification' in window)) {
      return false;
    }

    try {
      const permission = await Notification.requestPermission();
      this.permissionGranted = permission === 'granted';
      return this.permissionGranted;
    } catch {
      return false;
    }
  }

  async checkPermission(): Promise<boolean> {
    if (this.isNativePlatform) {
      return false;
    }

    if (typeof window === 'undefined' || !('Notification' in window)) {
      return false;
    }

    return Notification.permission === 'granted';
  }

  async showLocalNotification(title: string, body: string, data?: Record<string, unknown>): Promise<void> {
    if (this.isNativePlatform) {
      return;
    }

    if (typeof window === 'undefined' || !('Notification' in window)) {
      return;
    }

    try {
      if (Notification.permission === 'granted') {
        const notification = new Notification(title, {
          body,
          icon: '/assets/icon/favicon.png',
          data
        });

        notification.onclick = () => {
          window.focus();
          this.handleNotificationAction(data);
          notification.close();
        };
      }
    } catch (error) {
      console.warn('Failed to show notification');
    }
  }

  private handleNotificationAction(data?: Record<string, unknown>): void {
    if (!data) return;

    const type = data['type'] as string;
    const id = data['id'] as string;

    switch (type) {
      case 'appointment':
        window.location.href = `/home`;
        break;
      case 'message':
        if (id) {
          window.location.href = `/consultation/${id}`;
        } else {
          window.location.href = `/home`;
        }
        break;
      case 'consultation':
        if (id) {
          window.location.href = `/consultation/${id}`;
        }
        break;
      default:
        window.location.href = `/notifications`;
    }
  }

  get isSupported(): boolean {
    return !this.isNativePlatform && typeof window !== 'undefined' && 'Notification' in window;
  }
}
