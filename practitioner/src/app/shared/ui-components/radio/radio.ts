import { Component, forwardRef, input } from '@angular/core';
import {
  FormsModule,
  NG_VALUE_ACCESSOR,
  ControlValueAccessor,
} from '@angular/forms';
import { RadioButtonItem } from '../../models/radio';
import { Typography } from '../typography/typography';
import { TypographyTypeEnum } from '../../constants/typography';
import { NgTemplateOutlet } from '@angular/common';

let nextUniqueId = 0;

@Component({
  selector: 'app-radio',
  imports: [FormsModule, Typography, NgTemplateOutlet],
  templateUrl: './radio.html',
  styleUrl: './radio.scss',
  providers: [
    {
      provide: NG_VALUE_ACCESSOR,
      useExisting: forwardRef(() => Radio),
      multi: true,
    },
  ],
})
export class Radio implements ControlValueAccessor {
  label = input<string>();
  flexRow = input<boolean>(false);
  items = input<RadioButtonItem[]>([]);

  disabled = false;

  private innerValue: string | number = '';
  private _name = `switch-radio-group-${nextUniqueId++}`;

  get name(): string {
    return this._name;
  }

  set name(value: string) {
    this._name = value;
  }

  get value(): string | number | boolean {
    return this.innerValue;
  }

  set value(v: string | number) {
    if (v !== this.innerValue) {
      this.innerValue = v;
      this.change(v);
    }
  }

  onChange: (value: string | number) => void = () => {
    //
  };
  onTouched = () => {
    //
  };

  writeValue(value: string | number) {
    if (value !== this.innerValue) {
      this.innerValue = value;
    }
  }

  getLabelColor(id: string | number) {
    if (this.value === id) {
      return 'var(--slate-800)';
    } else {
      return 'var(--slate-500)';
    }
  }

  registerOnChange(fn: (value: string | number) => void): void {
    this.onChange = fn;
  }

  registerOnTouched(fn: () => void): void {
    this.onTouched = fn;
  }

  change(value: string | number) {
    this.innerValue = value;
    this.onTouched();
    this.onChange(value);
  }

  setDisabledState(isDisabled: boolean): void {
    this.disabled = isDisabled;
  }

  protected readonly TypographyTypeEnum = TypographyTypeEnum;
}

