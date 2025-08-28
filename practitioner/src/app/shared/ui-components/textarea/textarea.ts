import { Component, ElementRef, forwardRef, input, ViewChild } from '@angular/core';
import {ErrorMessage} from "../../components/error-message/error-message";
import {Svg} from "../svg/svg";
import { NG_VALUE_ACCESSOR } from '@angular/forms';
import { InputSize } from '../../models/input';

@Component({
  selector: 'app-textarea',
  imports: [ErrorMessage, Svg],
  templateUrl: './textarea.html',
  styleUrl: './textarea.scss',
  providers: [
    {
      provide: NG_VALUE_ACCESSOR,
      useExisting: forwardRef(() => Textarea),
      multi: true,
    },
  ],
})
export class Textarea {
  @ViewChild('nativeInput') nativeInput!: ElementRef<HTMLTextAreaElement>;

  size = input<InputSize>('normal');
  placeholder = input<string>('');
  name = input<string>('');
  leftIcon = input<string>('');
  rightIcon = input<string>('');
  width = input<string>('');
  invalid = input<boolean>(false);
  invalidMessage = input<string>('');
  label = input<string>();
  id = input<string>();
  rows = input<number>(4);

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

  focus() {
    this.nativeInput.nativeElement.focus();
  }

}
