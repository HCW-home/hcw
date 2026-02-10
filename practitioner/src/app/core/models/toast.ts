export type ToastType = 'success' | 'error' | 'warning' | 'info' | 'neutral';

export interface IToastAction {
  label: string;
  callback: () => void;
}

export interface IToast {
  id: string;
  type: ToastType;
  title?: string;
  body?: string;
  delay?: number;
  icon?: string;
  closable?: boolean;
  actions?: IToastAction[];
  trace?: string;
}

export type Toast = IToast;
