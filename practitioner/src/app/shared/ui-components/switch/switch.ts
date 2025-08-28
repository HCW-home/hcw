import { Component, forwardRef, input } from '@angular/core';
import { ControlValueAccessor, FormsModule, NG_VALUE_ACCESSOR } from '@angular/forms';
import { Typography } from '../typography/typography';
import { TypographyTypeEnum } from '../../constants/typography';

@Component({
  selector: 'app-switch',
  imports: [FormsModule, Typography],
  templateUrl: './switch.html',
  styleUrl: './switch.scss',
  providers: [
    {
      provide: NG_VALUE_ACCESSOR,
      useExisting: forwardRef(() => Switch),
      multi: true,
    },
  ],
})
export class Switch implements ControlValueAccessor {
  name = input<string>();
  label = input<string>();
  fixedHeight = input<boolean>();
  disabled = false;
  checked = false;
  id = `switch-${Math.random().toString(36).substring(2)}`;

  onChange: (value: boolean) => void = () => {
    //
  };
  onTouched = () => {
    //
  };

  registerOnChange(fn: (value: boolean) => void): void {
    this.onChange = fn;
  }

  registerOnTouched(fn: () => void): void {
    this.onTouched = fn;
  }

  writeValue(checked: boolean) {
    this.checked = checked;
  }

  setDisabledState(isDisabled: boolean): void {
    this.disabled = isDisabled;
  }

  onModelChange(e: boolean) {
    this.checked = e;
    this.onChange(e);
  }

  protected readonly TypographyTypeEnum = TypographyTypeEnum;
}
