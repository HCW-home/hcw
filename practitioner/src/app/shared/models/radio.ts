import { TemplateRef } from '@angular/core';
import { Input } from '../ui-components/input/input';

export interface RadioButtonItem {
  value: string | number;
  label: string;
  subtitle?: string;
  summary?: string;
  hint?: string;

  hasInput?: boolean;
  template?: TemplateRef<Input>;
  template2?: TemplateRef<Input>;
}
