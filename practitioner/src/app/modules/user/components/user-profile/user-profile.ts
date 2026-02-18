import {
  Component,
  OnInit,
  OnDestroy,
  signal,
  inject,
  ViewChild,
  ElementRef,
} from '@angular/core';
import {
  FormBuilder,
  FormGroup,
  Validators,
  ReactiveFormsModule,
} from '@angular/forms';
import { CommonModule } from '@angular/common';
import { Subject, takeUntil } from 'rxjs';

import { UserService } from '../../../../core/services/user.service';
import { Auth } from '../../../../core/services/auth';
import { ToasterService } from '../../../../core/services/toaster.service';
import { IUser, IUserUpdateRequest, ILanguage } from '../../models/user';
import { CommunicationMethodEnum } from '../../constants/user';

import { Page } from '../../../../core/components/page/page';
import { Loader } from '../../../../shared/components/loader/loader';
import { Badge } from '../../../../shared/components/badge/badge';
import { Select } from '../../../../shared/ui-components/select/select';
import { Svg } from '../../../../shared/ui-components/svg/svg';

import { BadgeTypeEnum } from '../../../../shared/constants/badge';
import { SelectOption } from '../../../../shared/models/select';
import { ValidationService } from '../../../../core/services/validation.service';
import { TranslationService } from '../../../../core/services/translation.service';
import { getErrorMessage } from '../../../../core/utils/error-helper';
import { TIMEZONE_OPTIONS } from '../../../../shared/constants/timezone';
import { TranslatePipe } from '@ngx-translate/core';

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
    TranslatePipe,
  ],
})
export class UserProfile implements OnInit, OnDestroy {
  @ViewChild('avatarFileInput') avatarFileInput!: ElementRef<HTMLInputElement>;

  private destroy$ = new Subject<void>();
  public validationService = inject(ValidationService);
  private t = inject(TranslationService);

  protected readonly BadgeTypeEnum = BadgeTypeEnum;

  user = signal<IUser | null>(null);
  languages = signal<ILanguage[]>([]);
  isLoadingUser = signal(false);
  isSaving = signal(false);
  isUploadingAvatar = signal(false);

  profileForm: FormGroup;

  get communicationMethods(): SelectOption[] {
    return [
      { label: this.t.instant('userProfile.commSms'), value: CommunicationMethodEnum.SMS },
      { label: this.t.instant('userProfile.commEmail'), value: CommunicationMethodEnum.EMAIL },
      { label: this.t.instant('userProfile.commWhatsApp'), value: CommunicationMethodEnum.WHATSAPP },
      { label: this.t.instant('userProfile.commPush'), value: CommunicationMethodEnum.PUSH },
      { label: this.t.instant('userProfile.commManual'), value: CommunicationMethodEnum.MANUAL },
    ];
  }
  timezoneOptions: SelectOption[] = TIMEZONE_OPTIONS;
  languageOptions = signal<SelectOption[]>([]);
  preferredLanguageOptions = signal<SelectOption[]>([]);

  constructor(
    private fb: FormBuilder,
    private userService: UserService,
    private authService: Auth,
    private toasterService: ToasterService
  ) {
    this.profileForm = this.fb.group({
      first_name: [{ value: '', disabled: true }],
      last_name: [{ value: '', disabled: true }],
      email: [{ value: '', disabled: true }],
      mobile_phone_number: [''],
      communication_method: ['email', [Validators.required]],
      preferred_language: [null],
      timezone: ['UTC', Validators.required],
      language_ids: [[]],
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
    this.userService
      .getCurrentUser()
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: user => {
          this.user.set(user);
          this.populateForm(user);
          this.isLoadingUser.set(false);
        },
        error: error => {
          this.isLoadingUser.set(false);
          this.toasterService.show(
            'error',
            this.t.instant('userProfile.errorLoadingProfile'),
            getErrorMessage(error)
          );
        },
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
      language_ids: languageIds,
    });
  }

  saveProfile(): void {
    if (this.profileForm.valid && !this.isSaving()) {
      this.isSaving.set(true);

      const formValue = this.profileForm.value;
      const updateData: IUserUpdateRequest = {
        mobile_phone_number: formValue.mobile_phone_number || undefined,
        communication_method: formValue.communication_method,
        preferred_language: formValue.preferred_language,
        timezone: formValue.timezone,
        language_ids: this.getLanguageIds(formValue.language_ids),
      };

      this.userService
        .updateCurrentUser(updateData)
        .pipe(takeUntil(this.destroy$))
        .subscribe({
          next: updatedUser => {
            this.user.set(updatedUser);
            this.isSaving.set(false);
            this.toasterService.show(
              'success',
              this.t.instant('userProfile.profileUpdated'),
              this.t.instant('userProfile.profileUpdatedMessage')
            );
          },
          error: error => {
            this.isSaving.set(false);
            this.toasterService.show(
              'error',
              this.t.instant('userProfile.errorUpdatingProfile'),
              getErrorMessage(error)
            );
          },
        });
    } else {
      this.validationService.validateAllFormFields(this.profileForm);
    }
  }

  loadDropdownData(): void {
    this.authService
      .getOpenIDConfig()
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: config => {
          this.preferredLanguageOptions.set(
            (config.languages || []).map(lang => ({
              label: lang.name,
              value: lang.code,
            }))
          );
        },
      });

    this.userService
      .getLanguages()
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: languages => {
          this.languages.set(languages);
          this.languageOptions.set(
            languages.map(lang => ({
              label: lang.name,
              value: lang.code,
            }))
          );
        },
        error: error => {
          this.toasterService.show(
            'error',
            this.t.instant('userProfile.errorLoadingLanguages'),
            getErrorMessage(error)
          );
        },
      });
  }

  private getLanguageIds(languageIds: number[]): number[] {
    return languageIds || [];
  }

  getInitials(): string {
    const user = this.user();
    if (!user) return '';
    const first = user.first_name?.charAt(0) || '';
    const last = user.last_name?.charAt(0) || '';
    return (first + last).toUpperCase();
  }

  openAvatarFilePicker(): void {
    this.avatarFileInput.nativeElement.click();
  }

  onAvatarFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    if (input.files && input.files.length > 0) {
      const file = input.files[0];
      if (file.type.startsWith('image/')) {
        this.uploadAvatar(file);
      } else {
        this.toasterService.show(
          'error',
          this.t.instant('userProfile.invalidFile'),
          this.t.instant('userProfile.invalidFileMessage')
        );
      }
    }
    input.value = '';
  }

  uploadAvatar(file: File): void {
    this.isUploadingAvatar.set(true);
    this.userService
      .uploadProfilePicture(file)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: updatedUser => {
          this.user.set(updatedUser);
          this.isUploadingAvatar.set(false);
          this.toasterService.show(
            'success',
            this.t.instant('userProfile.pictureUpdated'),
            this.t.instant('userProfile.pictureUpdatedMessage')
          );
        },
        error: error => {
          this.isUploadingAvatar.set(false);
          this.toasterService.show(
            'error',
            this.t.instant('userProfile.errorUploadingPicture'),
            getErrorMessage(error)
          );
        },
      });
  }
}
