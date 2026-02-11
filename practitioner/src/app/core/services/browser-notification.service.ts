import { Injectable } from '@angular/core';

@Injectable({
  providedIn: 'root'
})
export class BrowserNotificationService {
  private permission: NotificationPermission = 'default';

  get isSupported(): boolean {
    return 'Notification' in window;
  }

  get isGranted(): boolean {
    return this.permission === 'granted';
  }

  async requestPermission(): Promise<boolean> {
    if (!this.isSupported) {
      return false;
    }

    this.permission = Notification.permission;
    if (this.permission === 'granted') {
      return true;
    }

    if (this.permission === 'denied') {
      return false;
    }

    this.permission = await Notification.requestPermission();
    return this.permission === 'granted';
  }

  showNotification(title: string, body: string, onClick?: () => void): void {
    console.log('[BrowserNotification] showNotification called:', { title, body, supported: this.isSupported, granted: this.isGranted });
    if (!this.isSupported || !this.isGranted) {
      return;
    }

    const notification = new Notification(title, {
      body,
      icon: '/svg/logo.svg',
      tag: 'hcw-notification',
    });

    notification.onclick = () => {
      window.focus();
      onClick?.();
      notification.close();
    };
  }
}
