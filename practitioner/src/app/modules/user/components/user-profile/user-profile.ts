import { Component, OnInit, OnDestroy, signal } from '@angular/core';
import { FormBuilder, FormGroup, Validators, ReactiveFormsModule } from '@angular/forms';
import { CommonModule } from '@angular/common';
import { Subject, takeUntil } from 'rxjs';

import { UserService } from '../../../../core/services/user.service';
import { ToasterService } from '../../../../core/services/toaster.service';
import { User, UpdateUserRequest } from '../../../../core/models/user';

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

  user = signal<User | null>(null);
  isLoadingUser = signal(false);
  isEditing = signal(false);
  isSaving = signal(false);

  profileForm: FormGroup;

  // Constants for templates
  protected readonly TypographyTypeEnum = TypographyTypeEnum;
  protected readonly ButtonSizeEnum = ButtonSizeEnum;
  protected readonly ButtonStyleEnum = ButtonStyleEnum;
  protected readonly BadgeTypeEnum = BadgeTypeEnum;

  // Communication method options
  communicationMethods: SelectOption[] = [
    { value: 'email', label: 'Email' },
    { value: 'sms', label: 'SMS' },
    { value: 'whatsapp', label: 'WhatsApp' }
  ];

  constructor(
    private fb: FormBuilder,
    private userService: UserService,
    private toasterService: ToasterService
  ) {
    this.profileForm = this.fb.group({
      first_name: ['', [Validators.required]],
      last_name: ['', [Validators.required]],
      email: [{ value: '', disabled: true }],
      mobile_phone_numer: [''],
      communication_method: ['email', [Validators.required]]
    });
  }

  ngOnInit(): void {
    this.loadUserProfile();
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

  private populateForm(user: User): void {
    this.profileForm.patchValue({
      first_name: user.first_name,
      last_name: user.last_name,
      email: user.email,
      mobile_phone_numer: user.mobile_phone_numer || '',
      communication_method: user.communication_method
    });
  }

  toggleEdit(): void {
    const currentEditState = this.isEditing();
    if (currentEditState) {
      // Cancel editing - reset form to original values
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
      const updateData: UpdateUserRequest = {
        first_name: formValue.first_name,
        last_name: formValue.last_name,
        mobile_phone_numer: formValue.mobile_phone_numer || undefined,
        communication_method: formValue.communication_method
      };

      this.userService.updateProfile(updateData)
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
}
