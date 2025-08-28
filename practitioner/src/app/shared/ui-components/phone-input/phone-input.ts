import {
  Component,
  ElementRef,
  forwardRef,
  input,
  output,
  ViewChild,
} from '@angular/core';
import { NG_VALUE_ACCESSOR } from '@angular/forms';
import { Svg } from '../svg/svg';
import { InputSize } from '../../models/input';
import { ErrorMessage } from '../../components/error-message/error-message';
import { NgxMaskDirective, provideNgxMask } from 'ngx-mask';

@Component({
  selector: 'app-phone-input',
  imports: [Svg, ErrorMessage, NgxMaskDirective],
  templateUrl: './phone-input.html',
  styleUrl: './phone-input.scss',
  providers: [
    {
      provide: NG_VALUE_ACCESSOR,
      useExisting: forwardRef(() => PhoneInput),
      multi: true,
    },
    provideNgxMask()
  ],
})
export class PhoneInput {
  @ViewChild('nativeInput') nativeInput!: ElementRef<HTMLInputElement>;

  size = input<InputSize>('normal');
  placeholder = input<string>('');
  name = input<string>('');
  leftIcon = input<string>('');
  rightIcon = input<string>();
  width = input<string>('');
  invalid = input<boolean>(false);
  invalidMessage = input<string>('');
  autocomplete = input<string>('');
  label = input<string>();
  id = input<string>();

  focusEvent = output<FocusEvent>();

  value = '';
  disabled = false;

  onChange: (value: string) => void = () => {
    //
  };
  onTouched: () => void = () => {
    //
  };

  onInput(event: Event): void {
    const newValue = (event.target as HTMLInputElement).value;
    this.value = newValue;
    this.onChange(newValue);
  }

  writeValue(value: string | null): void {
    this.value = value ?? '';
  }

  registerOnChange(fn: (value: string) => void): void {
    this.onChange = fn;
  }

  registerOnTouched(fn: () => void): void {
    this.onTouched = fn;
  }

  setDisabledState(isDisabled: boolean): void {
    this.disabled = isDisabled;
  }

  handleFocus(event: FocusEvent) {
    this.focusEvent.emit(event);
  }

  focus() {
    this.nativeInput.nativeElement.focus();
  }
}
