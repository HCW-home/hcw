import {
  input,
  output,
  signal,
  computed,
  Component,
  ElementRef,
  forwardRef,
  ViewChild,
} from '@angular/core';
import { NG_VALUE_ACCESSOR } from '@angular/forms';
import { Svg } from '../svg/svg';
import { InputSize } from '../../models/input';
import { ErrorMessage } from '../../components/error-message/error-message';
import { NgxMaskDirective } from 'ngx-mask';

@Component({
  selector: 'app-mask-input',
  imports: [Svg, ErrorMessage, NgxMaskDirective],
  templateUrl: './mask-input.html',
  styleUrl: './mask-input.scss',
  providers: [
    {
      provide: NG_VALUE_ACCESSOR,
      useExisting: forwardRef(() => MaskInput),
      multi: true,
    },
  ],
})
export class MaskInput {
  @ViewChild('nativeInput') nativeInput!: ElementRef<HTMLInputElement>;
  @ViewChild(NgxMaskDirective, { static: true }) maskDir!: NgxMaskDirective;

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
  id = input<string>();

  mask = input<string>();
  thousandSeparator = input<string>();
  decimalMarker = input<string>();
  prefix = input<string>('');
  suffix = input<string>('');
  dropSpecialCharacters = input<boolean>(true);
  clearIfNotMatch = input<boolean>(false);
  showMaskTyped = input<boolean>(false);

  protected passwordVisible = signal(false);
  inputType = computed(() =>
    this.type() === 'password'
      ? this.passwordVisible()
        ? 'text'
        : 'password'
      : this.type()
  );
  focusEvent = output<FocusEvent>();

  value = '';
  disabled = false;

  onChange: (value: string) => void = () => undefined;
  onTouched: () => void = () => undefined;

  onInput(event: Event): void {
    const newValue = (event.target as HTMLInputElement).value;
    this.value = newValue;
    this.onChange(newValue);
  }

  writeValue(obj: string | null | undefined): void {
    this.maskDir.writeValue(obj);
  }

  registerOnChange(fn: (value: string) => void): void {
    this.onChange = fn;
    this.maskDir.registerOnChange(fn);
  }

  registerOnTouched(fn: () => void): void {
    this.onTouched = fn;
    this.maskDir.registerOnTouched(fn);
  }

  setDisabledState(isDisabled: boolean): void {
    this.disabled = isDisabled;
    this.maskDir.setDisabledState(isDisabled);
  }

  handleFocus(event: FocusEvent) {
    this.focusEvent.emit(event);
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
