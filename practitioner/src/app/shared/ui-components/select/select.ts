import {
  Component,
  ElementRef,
  forwardRef,
  HostBinding,
  HostListener,
  input,
  OnChanges,
  output,
  SimpleChanges,
} from '@angular/core';
import { ControlValueAccessor, NG_VALUE_ACCESSOR } from '@angular/forms';
import { SelectOption } from '../../models/select';
import { Svg } from '../svg/svg';
import { Typography } from '../typography/typography';
import { TypographyTypeEnum } from '../../constants/typography';
import { ErrorMessage } from '../../components/error-message/error-message';

@Component({
  selector: 'app-select',
  imports: [Svg, Typography, ErrorMessage],
  templateUrl: './select.html',
  styleUrl: './select.scss',
  providers: [
    {
      provide: NG_VALUE_ACCESSOR,
      useExisting: forwardRef(() => Select),
      multi: true,
    },
  ],
})
export class Select implements ControlValueAccessor, OnChanges {
  label = input<string>();
  name = input<string>();
  required = input<boolean>(false);
  options = input<SelectOption[]>([]);
  placeholder = input('Select…');
  multiSelect = input(false);
  searchable = input(true);
  invalid = input<boolean>(false);
  invalidMessage = input<string>('');
  creatable = input(false);
  createOptionLabel = input<string>('');
  clearable = input(false);
  openUp = input(false);
  createItem = output<boolean>();

  value: string | number | null = null;
  display = '';
  selectedValues: SelectOption[] = [];
  hoverIndex: number | null = null;
  searchTerm = '';

  @HostBinding('class.open') open = false;
  @HostBinding('class.disabled') disabled = false;
  @HostBinding('class.drop-up') dropUp = false;

  constructor(private elementRef: ElementRef<HTMLElement>) {}

  private onChange: (value: string | number | (string | number)[] | null) => void = () => undefined;
  private onTouched: () => void = () => undefined;

  ngOnChanges(changes: SimpleChanges) {
    if (changes['options'] && !changes['options'].firstChange) {
      this.writeValue(this.value);
    }
  }

  writeValue(obj: string | number | (string | number)[] | null): void {
    if (this.multiSelect()) {
      const arr = Array.isArray(obj) ? obj : [];
      this.selectedValues = this.options().filter(o => arr.includes(o.value));
    } else {
      this.value = Array.isArray(obj) ? null : obj;
      const match = this.options().find(o => o.value === obj);
      this.display = match ? match.label : '';
    }
  }

  registerOnChange(fn: (value: string | number | (string | number)[] | null) => void): void {
    this.onChange = fn;
  }

  registerOnTouched(fn: () => void): void {
    this.onTouched = fn;
  }

  setDisabledState(isDisabled: boolean): void {
    this.disabled = isDisabled;
  }

  toggleDropdown(): void {
    if (this.disabled) return;
    if (this.open) {
      this.open = false;
      this.dropUp = false;
    } else {
      this.openDropdown();
    }
  }

  openDropdown(): void {
    if (this.disabled || this.open) return;
    this.open = true;
    this.onTouched();
    this.updateDropDirection();
  }

  private updateDropDirection(): void {
    if (this.openUp()) {
      this.dropUp = true;
      return;
    }
    const el = this.elementRef.nativeElement;
    const rect = el.getBoundingClientRect();
    const spaceBelow = window.innerHeight - rect.bottom;
    this.dropUp = spaceBelow < 220;
  }

  onSearchInput(event: Event): void {
    const target = event.target as HTMLInputElement;
    this.searchTerm = target.value;

    if (!this.multiSelect() && this.open) {
      const match = this.filteredOptions.find(
        opt => opt.label.toLowerCase() === this.searchTerm.toLowerCase()
      );
      if (match) {
        this.selectOption(match);
      }
    }
  }

  get filteredOptions(): SelectOption[] {
    const search = this.searchTerm.toLowerCase();
    const base = this.options().filter(opt =>
      opt.label.toLowerCase().includes(search)
    );
    if (this.creatable() && !base.some(o => o.label.toLowerCase() === search)) {
      const fake: SelectOption = {
        value: this.createOptionLabel(),
        label: this.createOptionLabel(),
        disabled: false,
        isNew: true,
      };
      return [fake, ...base];
    }

    return base;
  }

  searchInputValue(): string {
    if (this.multiSelect()) {
      return this.searchTerm;
    }
    return this.open ? this.searchTerm : this.display;
  }

  onOptionClick(opt: SelectOption): void {
    if (opt.disabled) return;

    if (!opt.isNew) {
      if (this.multiSelect()) {
        const idx = this.selectedValues.findIndex(o => o.value === opt.value);
        if (idx !== -1) {
          this.selectedValues.splice(idx, 1);
        } else {
          this.selectedValues.push(opt);
        }
        this.onChange(this.selectedValues.map(o => o.value));
      } else {
        this.selectOption(opt);
      }
    } else {
      this.createItem.emit(true);
    }
  }

  isSelected(opt: SelectOption): boolean {
    if (this.multiSelect()) {
      return this.selectedValues.some(o => o.value === opt.value);
    }
    return this.value === opt.value;
  }

  selectOption(opt: SelectOption): void {
    this.value = opt.value;
    this.display = opt.label;
    this.onChange(opt.value);
    this.open = false;
  }

  clearValue(event: Event): void {
    event.stopPropagation();
    this.value = null;
    this.display = '';
    this.searchTerm = '';
    this.onChange(null);
  }

  removeSelected(item: SelectOption): void {
    this.selectedValues = this.selectedValues.filter(
      o => o.value !== item.value
    );
    this.onChange(this.selectedValues.map(o => o.value));
  }

  @HostListener('document:click', ['$event'])
  onClickOutside(event: MouseEvent): void {
    if (!this.elementRef.nativeElement.contains(event.target as Node)) {
      this.open = false;
    }
  }

  protected readonly TypographyTypeEnum = TypographyTypeEnum;
}
