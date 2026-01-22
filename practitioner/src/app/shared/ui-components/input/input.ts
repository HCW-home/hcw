import {
  Component, computed,
  ElementRef,
  forwardRef,
  input, output, signal,
  ViewChild,
} from '@angular/core';
import { NG_VALUE_ACCESSOR } from '@angular/forms';
import { Svg } from '../svg/svg';
import { InputSize } from '../../models/input';
import { ErrorMessage } from '../../components/error-message/error-message';

@Component({
  selector: 'app-input',
  imports: [Svg, ErrorMessage],
  templateUrl: './input.html',
  styleUrl: './input.scss',
  providers: [
    {
      provide: NG_VALUE_ACCESSOR,
      useExisting: forwardRef(() => Input),
      multi: true,
    },
  ],
})
export class Input {
  @ViewChild('nativeInput') nativeInput!: ElementRef<HTMLInputElement>;

  type = input<string>('text');
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
  required = input<boolean>(false);
  id = input<string>();
  min = input<string>();
  max = input<string>()

  protected passwordVisible = signal(false);
  protected isFocused = signal(false);


  inputType = computed(() => {
    if (this.type() === 'password') {
      return this.passwordVisible() ? 'text' : 'password';
    }
    if (this.type() === 'date' && this.placeholder() && !this.value && !this.isFocused()) {
      return 'text';
    }
    return this.type();
  });
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
    this.isFocused.set(true);
    this.focusEvent.emit(event);
  }

  handleBlur() {
    this.isFocused.set(false);
    this.onTouched();
  }

  togglePasswordVisibility() {
    if (this.type() === 'password') {
      this.passwordVisible.update(v => !v);
    }
  }

  focus() {
    this.nativeInput.nativeElement.focus();
  }
}
