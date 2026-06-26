import {
  Input,
  inject,
  signal,
  Output,
  forwardRef,
  Component,
  EventEmitter,
  DestroyRef,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { CommonModule } from '@angular/common';
import {
  ControlValueAccessor,
  NG_VALUE_ACCESSOR,
  FormControl,
  ReactiveFormsModule,
} from '@angular/forms';
import { Observable, map } from 'rxjs';

import { Select, AsyncSearchFn, AsyncSearchResult } from '../../ui-components/select/select';
import { ModalComponent } from '../modal/modal.component';
import { AddEditPatient } from '../../../modules/user/components/add-edit-patient/add-edit-patient';
import { SelectOption } from '../../models/select';
import { IUser } from '../../../modules/user/models/user';
import { UserService } from '../../../core/services/user.service';
import { TranslationService } from '../../../core/services/translation.service';

/**
 * Reusable "select an existing user OR create a new one" field.
 *
 * - Encapsulates an async-search `app-select` (creatable) plus the
 *   `add-edit-patient` modal used to create a new contact on the fly.
 * - Implements ControlValueAccessor: the form value is the selected user pk
 *   (number) or null.
 * - Also emits the full IUser via `userSelected` for callers that need it.
 */
@Component({
  selector: 'app-user-select-or-create',
  templateUrl: './user-select-or-create.html',
  providers: [
    {
      provide: NG_VALUE_ACCESSOR,
      useExisting: forwardRef(() => UserSelectOrCreate),
      multi: true,
    },
  ],
  imports: [
    CommonModule,
    ReactiveFormsModule,
    Select,
    ModalComponent,
    AddEditPatient,
  ],
})
export class UserSelectOrCreate implements ControlValueAccessor {
  private userService = inject(UserService);
  private t = inject(TranslationService);
  private destroyRef = inject(DestroyRef);

  constructor() {
    // Propagate dropdown selection (the select is a CVA on the pk value).
    this.control.valueChanges
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(value => {
        this.onChange(value ?? null);
        this.onTouched();
        const user = value != null ? this.cache.get(value) ?? null : null;
        this.userSelected.emit(user);
      });
  }

  @Input() label = '';
  @Input() placeholder = '';
  @Input() required = false;
  @Input() clearable = true;
  @Input() meUser: IUser | null = null;
  @Input() initialUser: IUser | null = null;
  // Restrict the search to practitioners when true.
  @Input() onlyPractitioners = false;
  // Label of the "create" option in the dropdown.
  @Input() createLabel = '';

  @Output() userSelected = new EventEmitter<IUser | null>();

  control = new FormControl<number | null>(null);
  addModalOpen = signal(false);
  newUserInitialName = signal('');

  private cache = new Map<number, IUser>();
  private onChange: (value: number | null) => void = () => {};
  private onTouched: () => void = () => {};

  get createOptionLabel(): string {
    return this.createLabel || this.t.instant('consultationForm.addPatient');
  }

  get initialOption(): SelectOption | null {
    const u = this.initialUser;
    if (!u) return null;
    this.cache.set(u.pk, u);
    return this.toOption(u);
  }

  searchFn: AsyncSearchFn = (
    query: string,
    page: number
  ): Observable<AsyncSearchResult> => {
    return this.userService
      .searchUsers(
        query,
        page,
        20,
        false,
        undefined,
        this.onlyPractitioners ? true : undefined
      )
      .pipe(
        map(response => {
          const results: SelectOption[] = response.results.map(user => {
            this.cache.set(user.pk, user);
            return this.toOption(user);
          });
          return { results, hasMore: response.next !== null };
        })
      );
  };

  private toOption(user: IUser): SelectOption {
    const isCurrentUser = !!(this.meUser && user.pk === this.meUser.pk);
    const name = isCurrentUser
      ? this.t.instant('userSearchSelect.me')
      : `${user.first_name || ''} ${user.last_name || ''}`.trim() ||
        user.email ||
        user.username ||
        'User';
    return {
      value: user.pk,
      label: name,
      secondaryLabel: [user.email, user.mobile_phone_number]
        .filter(Boolean)
        .join(' · '),
      image: user.picture || undefined,
      initials: this.getUserInitials(user),
      isCurrentUser,
      isPractitioner: user.is_practitioner,
    };
  }

  private getUserInitials(user: IUser): string {
    const firstName = user.first_name || '';
    const lastName = user.last_name || '';
    if (firstName && lastName) {
      return `${firstName.charAt(0)}${lastName.charAt(0)}`.toUpperCase();
    }
    return (firstName || lastName || user.email || 'U').charAt(0).toUpperCase();
  }

  openAddModal(searchTerm: string): void {
    this.newUserInitialName.set(searchTerm || '');
    this.addModalOpen.set(true);
  }

  closeAddModal(): void {
    this.addModalOpen.set(false);
    this.newUserInitialName.set('');
  }

  onUserCreated(user: IUser): void {
    this.cache.set(user.pk, user);
    this.initialUser = user;
    // Triggers control.valueChanges -> onChange + userSelected propagation.
    this.control.setValue(user.pk);
    this.closeAddModal();
  }

  // ControlValueAccessor
  writeValue(value: number | null): void {
    this.control.setValue(value ?? null, { emitEvent: false });
  }
  registerOnChange(fn: (value: number | null) => void): void {
    this.onChange = fn;
  }
  registerOnTouched(fn: () => void): void {
    this.onTouched = fn;
  }
  setDisabledState(isDisabled: boolean): void {
    if (isDisabled) this.control.disable({ emitEvent: false });
    else this.control.enable({ emitEvent: false });
  }
}
