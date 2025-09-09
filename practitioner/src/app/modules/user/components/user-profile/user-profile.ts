import { Component, OnInit, OnDestroy, signal } from '@angular/core';
import { FormBuilder, FormGroup, Validators, ReactiveFormsModule } from '@angular/forms';
import { CommonModule } from '@angular/common';
import { Subject, takeUntil } from 'rxjs';

import { UserService } from '../../../../core/services/user.service';
import { ToasterService } from '../../../../core/services/toaster.service';
import { IUser, IUserUpdateRequest, ILanguage } from '../../models/user';
import { CommunicationMethodOptions, TimezoneOptions } from '../../constants/user';

import { Page } from '../../../../core/components/page/page';
import { BackButton } from '../../../../shared/components/back-button/back-button';
import { Badge } from '../../../../shared/components/badge/badge';
import { Loader } from '../../../../shared/components/loader/loader';

import { Typography } from '../../../../shared/ui-components/typography/typography';
import { Button } from '../../../../shared/ui-components/button/button';
import { Input } from '../../../../shared/ui-components/input/input';
import { Select } from '../../../../shared/ui-components/select/select';
import { Svg } from '../../../../shared/ui-components/svg/svg';

import { TypographyTypeEnum } from '../../../../shared/constants/typography';
import { ButtonSizeEnum, ButtonStyleEnum } from '../../../../shared/constants/button';
import { BadgeTypeEnum } from '../../../../shared/constants/badge';
import { SelectOption } from '../../../../shared/models/select';

@Component({
  selector: 'app-user-profile',
  templateUrl: './user-profile.html',
  styleUrl: './user-profile.scss',
  imports: [
    CommonModule,
    ReactiveFormsModule,
    Page,
    BackButton,
    Badge,
    Loader,
    Typography,
    Button,
    Input,
    Select,
    Svg
  ]
})
export class UserProfile implements OnInit, OnDestroy {
  private destroy$ = new Subject<void>();

  user = signal<IUser | null>(null);
  languages = signal<ILanguage[]>([]);
  isLoadingUser = signal(false);
  isEditing = signal(false);
  isSaving = signal(false);

  profileForm: FormGroup;

  protected readonly TypographyTypeEnum = TypographyTypeEnum;
  protected readonly ButtonSizeEnum = ButtonSizeEnum;
  protected readonly ButtonStyleEnum = ButtonStyleEnum;
  protected readonly BadgeTypeEnum = BadgeTypeEnum;

  communicationMethods: SelectOption[] = CommunicationMethodOptions;
  timezoneOptions: SelectOption[] = TimezoneOptions;
  languageOptions = signal<SelectOption[]>([]);

  constructor(
    private fb: FormBuilder,
    private userService: UserService,
    private toasterService: ToasterService
  ) {
    this.profileForm = this.fb.group({
      first_name: ['', [Validators.required, Validators.minLength(2)]],
      last_name: ['', [Validators.required, Validators.minLength(2)]],
      email: [{ value: '', disabled: true }],
      mobile_phone_numer: [''],
      communication_method: ['email', [Validators.required]],
      preferred_language: [''],
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
          console.error('Error loading user profile:', error);
          this.isLoadingUser.set(false);
          this.toasterService.show('error', 'Error loading user profile');
        }
      });
  }

  private populateForm(user: IUser): void {
    const languageCodes = user.languages?.map(lang => lang.code) || [];

    this.profileForm.patchValue({
      first_name: user.first_name || '',
      last_name: user.last_name || '',
      email: user.email,
      mobile_phone_numer: user.mobile_phone_numer || '',
      communication_method: user.communication_method || 'email',
      preferred_language: user.preferred_language || '',
      timezone: user.timezone || 'UTC',
      language_ids: languageCodes
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
        mobile_phone_numer: formValue.mobile_phone_numer || undefined,
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
            console.error('Error updating profile:', error);
            this.isSaving.set(false);
            this.toasterService.show('error', 'Error updating profile');
          }
        });
    }
  }

  formatDate(dateString?: string): string {
    if (!dateString) return 'Never';
    return new Date(dateString).toLocaleString();
  }

  getCommunicationMethodLabel(method: string): string {
    const option = this.communicationMethods.find(opt => opt.value === method);
    return option?.label || method;
  }

  loadDropdownData(): void {
    this.userService.getLanguages().toPromise().then(languages => {
      if (languages) {
        this.languages.set(languages);
        this.languageOptions.set(
          languages.map(lang => ({
            label: lang.name,
            value: lang.code
          }))
        );
      }
    }).catch(error => {
      console.error('Error loading languages:', error);
    });
  }

  private getLanguageIds(languageCodes: string[]): number[] {
    const languages = this.languages();
    return languageCodes
      .map(code => languages.find(lang => lang.code === code))
      .filter(lang => lang !== undefined)
      .map(lang => languages.indexOf(lang!) + 1);
  }


}
