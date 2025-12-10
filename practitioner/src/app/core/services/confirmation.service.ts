import { Injectable, signal } from '@angular/core';
import { Subject } from 'rxjs';

export interface ConfirmationConfig {
  title: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  confirmStyle?: 'primary' | 'danger';
}

@Injectable({
  providedIn: 'root',
})
export class ConfirmationService {
  isOpen = signal(false);
  config = signal<ConfirmationConfig | null>(null);

  private confirmSubject = new Subject<boolean>();

  confirm(config: ConfirmationConfig): Promise<boolean> {
    this.config.set(config);
    this.isOpen.set(true);

    return new Promise<boolean>(resolve => {
      const subscription = this.confirmSubject.subscribe(result => {
        subscription.unsubscribe();
        resolve(result);
      });
    });
  }

  handleConfirm(): void {
    this.isOpen.set(false);
    this.confirmSubject.next(true);
  }

  handleCancel(): void {
    this.isOpen.set(false);
    this.confirmSubject.next(false);
  }
}
