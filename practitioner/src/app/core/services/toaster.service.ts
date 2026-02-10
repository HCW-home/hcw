import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable } from 'rxjs';
import { IToast, ToastType } from '../models/toast';

const DEFAULT_DELAY = 5000;
const DEFAULT_ICONS: Record<ToastType, string> = {
  success: 'approve',
  error: 'error',
  warning: 'warning',
  info: 'info',
  neutral: '',
};

let toastIdCounter = 0;

@Injectable({
  providedIn: 'root',
})
export class ToasterService {
  private toastsSubject = new BehaviorSubject<IToast[]>([]);
  private timers = new Map<string, ReturnType<typeof setTimeout>>();

  toasts$: Observable<IToast[]> = this.toastsSubject.asObservable();

  show(
    type: ToastType,
    title?: string,
    body?: string,
    options?: number | Partial<IToast>
  ): string {
    const opts: Partial<IToast> =
      typeof options === 'number' ? { delay: options } : options || {};

    const id = opts.id || `toast-${++toastIdCounter}`;
    const delay = opts.delay ?? DEFAULT_DELAY;

    const toast: IToast = {
      id,
      type,
      title,
      body,
      delay,
      icon: opts.icon ?? DEFAULT_ICONS[type],
      closable: opts.closable ?? true,
      actions: opts.actions,
      trace: opts.trace,
    };

    const existing = this.toastsSubject.value.find(t => t.id === id);
    if (existing) {
      this.update(id, toast);
      return id;
    }

    this.toastsSubject.next([toast, ...this.toastsSubject.value]);
    this.startTimer(toast);
    return id;
  }

  update(id: string, changes: Partial<IToast>): void {
    const toasts = this.toastsSubject.value;
    const index = toasts.findIndex(t => t.id === id);
    if (index === -1) return;

    const updated = { ...toasts[index], ...changes, id };
    const next = [...toasts];
    next[index] = updated;
    this.toastsSubject.next(next);

    if (changes.delay !== undefined) {
      this.clearTimer(id);
      this.startTimer(updated);
    }
  }

  dismiss(id: string): void {
    this.clearTimer(id);
    this.toastsSubject.next(
      this.toastsSubject.value.filter(t => t.id !== id)
    );
  }

  dismissAll(): void {
    this.timers.forEach((_, id) => this.clearTimer(id));
    this.toastsSubject.next([]);
  }

  private startTimer(toast: IToast): void {
    const delay = toast.delay ?? DEFAULT_DELAY;
    if (delay < 0) return;

    const timer = setTimeout(() => {
      this.dismiss(toast.id);
    }, delay);
    this.timers.set(toast.id, timer);
  }

  private clearTimer(id: string): void {
    const timer = this.timers.get(id);
    if (timer) {
      clearTimeout(timer);
      this.timers.delete(id);
    }
  }
}
