import {Component, OnInit, OnDestroy, signal, inject} from '@angular/core';
import {FormBuilder, FormGroup, Validators, ReactiveFormsModule} from '@angular/forms';
import {CommonModule, Location} from '@angular/common';
import {Subject, takeUntil} from 'rxjs';

import {UserService} from '../../../../core/services/user.service';
import {ToasterService} from '../../../../core/services/toaster.service';
import {IUser, IUserUpdateRequest, ILanguage} from '../../models/user';
import {CommunicationMethodOptions, TimezoneOptions} from '../../constants/user';

import {Page} from '../../../../core/components/page/page';
import {Loader} from '../../../../shared/components/loader/loader';
import {Badge} from '../../../../shared/components/badge/badge';
import {Select} from '../../../../shared/ui-components/select/select';
import {Svg} from '../../../../shared/ui-components/svg/svg';

import {BadgeTypeEnum} from '../../../../shared/constants/badge';
import {SelectOption} from '../../../../shared/models/select';
import {ValidationService} from '../../../../core/services/validation.service';
import {getErrorMessage} from '../../../../core/utils/error-helper';

@Component({
  selector: 'app-user-profile',
  templateUrl: './user-profile.html',
  styleUrl: './user-profile.scss',
  imports: [
    Svg,
    Page,
    Loader,
    Badge,
    Select,
    CommonModule,
    ReactiveFormsModule,
  ]
})
export class UserProfile implements OnInit, OnDestroy {
  private destroy$ = new Subject<void>();
  private location = inject(Location);
  public validationService = inject(ValidationService);

  protected readonly BadgeTypeEnum = BadgeTypeEnum;

  user = signal<IUser | null>(null);
  languages = signal<ILanguage[]>([]);
  isLoadingUser = signal(false);
  isEditing = signal(false);
  isSaving = signal(false);

  profileForm: FormGroup;

  communicationMethods: SelectOption[] = CommunicationMethodOptions;
  timezoneOptions: SelectOption[] = TimezoneOptions;
  languageOptions = signal<SelectOption[]>([]);

  constructor(
    private fb: FormBuilder,
    private userService: UserService,
    private toasterService: ToasterService,
  ) {
    this.profileForm = this.fb.group({
      first_name: ['', [Validators.required, Validators.minLength(2)]],
      last_name: ['', [Validators.required, Validators.minLength(2)]],
      email: [{value: '', disabled: true}],
      mobile_phone_number: [''],
      communication_method: ['email', [Validators.required]],
      preferred_language: [null],
      timezone: ['UTC', Validators.required],
      language_ids: [[]]
    });
  }

  ngOnInit(): void {
    this.loadUserProfile();
    this.loadDropdownData();
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  loadUserProfile(): void {
    this.isLoadingUser.set(true);
    this.userService.getCurrentUser()
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (user) => {
          this.user.set(user);
          this.populateForm(user);
          this.isLoadingUser.set(false);
        },
        error: (error) => {
          this.isLoadingUser.set(false);
          this.toasterService.show('error', getErrorMessage(error));
        }
      });
  }

  private populateForm(user: IUser): void {
    const languageIds = user.languages?.map(lang => lang.id) || [];

    this.profileForm.patchValue({
      first_name: user.first_name || '',
      last_name: user.last_name || '',
      email: user.email,
      mobile_phone_number: user.mobile_phone_number || '',
      communication_method: user.communication_method || 'email',
      preferred_language: user.preferred_language || null,
      timezone: user.timezone || 'UTC',
      language_ids: languageIds
    });
  }

  toggleEdit(): void {
    const currentEditState = this.isEditing();
    if (currentEditState) {
      if (this.user()) {
        this.populateForm(this.user()!);
      }
    }
    this.isEditing.set(!currentEditState);
  }

  saveProfile(): void {
    if (this.profileForm.valid && !this.isSaving()) {
      this.isSaving.set(true);

      const formValue = this.profileForm.value;
      const updateData: IUserUpdateRequest = {
        first_name: formValue.first_name,
        last_name: formValue.last_name,
        mobile_phone_number: formValue.mobile_phone_number || undefined,
        communication_method: formValue.communication_method,
        preferred_language: formValue.preferred_language,
        timezone: formValue.timezone,
        language_ids: this.getLanguageIds(formValue.language_ids)
      };

      this.userService.updateCurrentUser(updateData)
        .pipe(takeUntil(this.destroy$))
        .subscribe({
          next: (updatedUser) => {
            this.user.set(updatedUser);
            this.isEditing.set(false);
            this.isSaving.set(false);
            this.toasterService.show('success', 'Profile updated successfully');
          },
          error: (error) => {
            this.isSaving.set(false);
            this.toasterService.show('error', getErrorMessage(error));
          }
        });
    } else {
      this.validationService.validateAllFormFields(this.profileForm);
    }
  }

  getCommunicationMethodLabel(method: string): string {
    const option = this.communicationMethods.find(opt => opt.value === method);
    return option?.label || method;
  }

  getPreferredLanguageName(): string {
    const user = this.user();
    if (!user?.preferred_language) return 'Not set';
    const language = this.languages().find(lang => lang.id === user.preferred_language);
    return language?.name || 'Not set';
  }

  loadDropdownData(): void {
    this.userService.getLanguages()
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: languages => {
          this.languages.set(languages);
          this.languageOptions.set(
            languages.map(lang => ({
              label: lang.name,
              value: lang.code
            }))
          );
        },
        error: (error) => {
          this.toasterService.show('error', getErrorMessage(error));
        }
      });
  }

  private getLanguageIds(languageIds: number[]): number[] {
    return languageIds || [];
  }

  goBack(): void {
    this.location.back();
  }

  getInitials(): string {
    const user = this.user();
    if (!user) return '';
    const first = user.first_name?.charAt(0) || '';
    const last = user.last_name?.charAt(0) || '';
    return (first + last).toUpperCase();
  }
}
