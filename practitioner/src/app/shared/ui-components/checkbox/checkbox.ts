import {
  input,
  Component,
  forwardRef,
  HostBinding,
  HostListener,
} from '@angular/core';
import { NG_VALUE_ACCESSOR } from '@angular/forms';
import { Typography } from '../typography/typography';
import { TypographyTypeEnum } from '../../constants/typography';
import { Svg } from '../svg/svg';

@Component({
  selector: 'app-checkbox',
  imports: [Typography, Svg],
  templateUrl: './checkbox.html',
  styleUrl: './checkbox.scss',
  providers: [
    {
      provide: NG_VALUE_ACCESSOR,
      useExisting: forwardRef(() => Checkbox),
      multi: true,
    },
  ],
})
export class Checkbox {
  @HostBinding('class.checked') checked = false;
  @HostBinding('class.disabled') disabled = false;
  @HostBinding('class.hover') hover = false;

  label = input<string>('');
  name = input<string>('');

  onChange: (value: boolean) => void = () => {
    //
  };
  onTouched = () => {
    //
  };

  @HostListener('click')
  toggle() {
    if (this.disabled) return;
    this.checked = !this.checked;
    this.onChange(this.checked);
    this.onTouched();
  }

  @HostListener('mouseenter') onMouseEnter() {
    this.hover = true;
  }

  @HostListener('mouseleave') onMouseLeave() {
    this.hover = false;
  }

  writeValue(value: boolean): void {
    this.checked = value;
  }

  registerOnChange(fn: (value: boolean) => void): void {
    this.onChange = fn;
  }

  registerOnTouched(fn: () => void): void {
    this.onTouched = fn;
  }

  setDisabledState(isDisabled: boolean): void {
    this.disabled = isDisabled;
  }

  protected readonly TypographyTypeEnum = TypographyTypeEnum;
}
