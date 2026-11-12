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
import { AuthBrandingComponent } from '../../shared/components/auth-branding/auth-branding.component';

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
    AuthBrandingComponent,
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
    if (this.isManualPreconfigured) {
      base.push('manual');
    }
    return base;
  }

  preferredLanguage = '';
  communicationMethod = 'email';
  isManualPreconfigured = false;
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
      this.preferredLanguage =
        user.preferred_language || this.t.currentLanguage();
      this.communicationMethod = user.communication_method || 'email';
      this.isManualPreconfigured = user.communication_method === 'manual';
      this.mobilePhoneNumber = user.mobile_phone_number || '';
      this.timezone =
        user.timezone && user.timezone !== 'UTC'
          ? user.timezone
          : Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
      this.requiresPassphrase.set(!!user.encryption_passphrase_pending);

      const config = await firstValueFrom(this.authService.getConfig());
      if (config?.communication_methods) {
        this.communicationMethods = config.communication_methods;
      }
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
    if (this.requiresPassphrase() && !this.encryptionPassphrase) {
      return false;
    }
    return true;
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

    const updates: Partial<User> = {
      preferred_language: this.preferredLanguage,
      communication_method: this.communicationMethod as User['communication_method'],
      mobile_phone_number: this.mobilePhoneNumber || '',
      timezone: this.timezone,
      is_first_login: false,
    };

    this.authService.updateProfile(updates).subscribe({
      next: () => {
        if (this.preferredLanguage) {
          this.t.setLanguage(this.preferredLanguage);
        }
        this.navCtrl.navigateRoot('/home');
      },
      error: async () => {
        this.saving.set(false);
        await this.showToast(this.t.instant('onboarding.errorMessage'), 'danger');
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
