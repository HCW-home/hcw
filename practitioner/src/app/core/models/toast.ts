export type ToastType = 'success' | 'error' | 'warning';

export interface Toast {
  type: ToastType;
  title?: string;
  body?: string;
  delay?: number;
}
