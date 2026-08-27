import { Component, OnInit, OnDestroy, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import {
  IonContent,
  IonItem,
  IonLabel,
  IonInput,
  IonSelect,
  IonSelectOption,
  IonButton,
  IonText,
  IonSpinner,
  NavController,
  ToastController,
} from '@ionic/angular/standalone';
import { TranslatePipe } from '@ngx-translate/core';
import { Subject, firstValueFrom } from 'rxjs';

import { AuthService } from '../../core/services/auth.service';
import { EncryptionService } from '../../core/services/encryption.service';
import { TranslationService } from '../../core/services/translation.service';
import { User } from '../../core/models/user.model';
import { TIMEZONES } from '../../core/constants/timezone';

@Component({
  selector: 'app-onboarding',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    IonContent,
    IonItem,
    IonLabel,
    IonInput,
    IonSelect,
    IonSelectOption,
    IonButton,
    IonText,
    IonSpinner,
    TranslatePipe,
  ],
  templateUrl: './onboarding.page.html',
  styleUrls: ['./onboarding.page.scss'],
})
export class OnboardingPage implements OnInit, OnDestroy {
  private authService = inject(AuthService);
  private encryptionService = inject(EncryptionService);
  private navCtrl = inject(NavController);
  private toastCtrl = inject(ToastController);
  private t = inject(TranslationService);

  private destroy$ = new Subject<void>();

  loading = signal(true);
  saving = signal(false);

  availableLanguages = this.t.availableLanguages;
  timezones: string[] = TIMEZONES;
  communicationMethods: string[] = [];

  private readonly onboardingMethods = ['sms', 'email'];

  get displayedCommunicationMethods(): string[] {
    const base = this.communicationMethods.length
      ? this.onboardingMethods.filter(m =>
          this.communicationMethods.includes(m),
        )
      : [...this.onboardingMethods];
    // Never drop the method the account already uses — sign-up picked it from
    // the identifier the person typed. Leaving it out would show an empty
    // select they cannot put back, 'manual' included.
    if (this.communicationMethod && !base.includes(this.communicationMethod)) {
      base.push(this.communicationMethod);
    }
    return base;
  }

  firstName = '';
  lastName = '';
  email = '';
  passwordLoginOffered = signal(false);
  password = '';
  passwordConfirm = '';

  preferredLanguage = '';
  communicationMethod = 'email';
  mobilePhoneNumber = '';
  timezone = 'UTC';

  requiresPassphrase = signal(false);
  encryptionPassphrase = '';
  newPassphraseShown = signal<string | null>(null);

  private currentUserId: number | null = null;

  async ngOnInit(): Promise<void> {
    await this.authService.authReady;
    await this.loadData();
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  private async loadData(): Promise<void> {
    try {
      const user: User = await firstValueFrom(this.authService.getCurrentUser());
      this.currentUserId = user.pk;
      this.firstName = user.first_name || '';
      this.lastName = user.last_name || '';
      this.email = user.email || '';
      this.preferredLanguage =
        user.preferred_language || this.t.currentLanguage();
      this.communicationMethod = user.communication_method || 'email';
      this.mobilePhoneNumber = user.mobile_phone_number || '';
      this.timezone =
        user.timezone && user.timezone !== 'UTC'
          ? user.timezone
          : Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
      const config = await firstValueFrom(this.authService.getConfig());
      if (config?.communication_methods) {
        this.communicationMethods = config.communication_methods;
      }
      // The pending flag survives on the account after encryption is turned
      // off instance-wide, so asking for the passphrase on that alone would
      // demand one for a feature nobody can use. EncryptionGuard gates on the
      // same pair.
      this.requiresPassphrase.set(
        !!config?.encryption_enabled && !!user.encryption_passphrase_pending,
      );
      // Offering a password on an instance that refuses password login for
      // patients would hand them a credential they can never use.
      this.passwordLoginOffered.set(
        !!config?.enable_patient_password_login && !config?.force_temporary_patients,
      );
    } catch {
      // Ignore - keep defaults
    } finally {
      this.loading.set(false);
    }
  }

  onLanguageChange(langCode: string): void {
    this.preferredLanguage = langCode;
    this.t.setLanguage(langCode);
  }

  isFormValid(): boolean {
    if (!this.communicationMethod || !this.timezone) {
      return false;
    }
    if (this.showMobilePhone && !this.mobilePhoneNumber) {
      return false;
    }
    // An account created from a phone number has no address on file, and the
    // API refuses communication_method=email without one.
    if (this.communicationMethod === 'email' && !this.email) {
      return false;
    }
    if (this.requiresPassphrase() && !this.encryptionPassphrase) {
      return false;
    }
    // The password is optional, but a half-filled pair is not.
    if (this.password && this.password !== this.passwordConfirm) {
      return false;
    }
    return true;
  }

  get showEmail(): boolean {
    return this.communicationMethod === 'email';
  }

  get showMobilePhone(): boolean {
    return (
      this.communicationMethod === 'sms' ||
      this.communicationMethod === 'whatsapp'
    );
  }

  async save(): Promise<void> {
    if (!this.isFormValid() || this.saving()) {
      return;
    }

    this.saving.set(true);

    if (this.requiresPassphrase() && this.currentUserId !== null) {
      try {
        await this.encryptionService.activatePassphrase(
          this.currentUserId,
          this.encryptionPassphrase,
        );
      } catch {
        this.saving.set(false);
        await this.showToast(
          this.t.instant('onboarding.encryptionInvalidPassphrase'),
          'danger',
        );
        return;
      }
    }

    if (this.password) {
      try {
        await firstValueFrom(this.authService.setPassword(this.password));
      } catch (error: any) {
        this.saving.set(false);
        const detail =
          error?.error?.new_password2?.[0] || error?.error?.new_password1?.[0];
        await this.showToast(
          detail || this.t.instant('onboarding.passwordRejected'),
          'danger',
        );
        return;
      }
    }

    const updates: Partial<User> = {
      first_name: this.firstName,
      last_name: this.lastName,
      preferred_language: this.preferredLanguage,
      communication_method: this.communicationMethod as User['communication_method'],
      mobile_phone_number: this.mobilePhoneNumber || '',
      timezone: this.timezone,
      is_first_login: false,
    };
    if (this.email) {
      updates.email = this.email;
    }

    this.authService.updateProfile(updates).subscribe({
      next: () => {
        if (this.preferredLanguage) {
          this.t.setLanguage(this.preferredLanguage);
        }
        this.navCtrl.navigateRoot('/home');
      },
      error: async (error: any) => {
        this.saving.set(false);
        // Surface what the API objected to instead of a blanket failure: the
        // usual cause is an address or number already used by someone else.
        const detail =
          error?.error?.email?.[0] ||
          error?.error?.mobile_phone_number?.[0] ||
          error?.error?.non_field_errors?.[0];
        await this.showToast(
          detail || this.t.instant('onboarding.errorMessage'),
          'danger',
        );
      },
    });
  }

  async forgotPassphrase(): Promise<void> {
    try {
      const response = await this.encryptionService.forgotPassphrase();
      this.newPassphraseShown.set(response.passphrase);
      this.encryptionPassphrase = response.passphrase;
    } catch {
      await this.showToast(
        this.t.instant('onboarding.errorMessage'),
        'danger',
      );
    }
  }

  private async showToast(
    message: string,
    color: 'success' | 'danger' | 'warning' = 'success',
  ): Promise<void> {
    const toast = await this.toastCtrl.create({
      message,
      duration: 3000,
      color,
    });
    await toast.present();
  }
}
