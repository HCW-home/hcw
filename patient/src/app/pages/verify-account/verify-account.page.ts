import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute } from '@angular/router';
import {
  FormBuilder,
  FormGroup,
  ReactiveFormsModule,
  Validators,
} from '@angular/forms';
import {
  IonContent,
  IonIcon,
  IonInput,
  IonItem,
  IonText,
  IonButton,
  IonSpinner,
  NavController,
  ToastController,
} from '@ionic/angular/standalone';
import { TranslatePipe } from '@ngx-translate/core';
import { firstValueFrom } from 'rxjs';
import { AuthService } from '../../core/services/auth.service';
import { TranslationService } from '../../core/services/translation.service';
import { identifierValidator } from '../../shared/tools/identifier';
import { AuthBrandingComponent } from '../../shared/components/auth-branding/auth-branding.component';
import { LanguageSelectorComponent } from '../../shared/components/language-selector/language-selector.component';

@Component({
  selector: 'app-verify-account',
  templateUrl: './verify-account.page.html',
  styleUrls: ['./verify-account.page.scss'],
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    IonContent,
    IonIcon,
    IonInput,
    IonItem,
    IonText,
    IonButton,
    IonSpinner,
    TranslatePipe,
    AuthBrandingComponent,
    LanguageSelectorComponent,
  ]
})
export class VerifyAccountPage implements OnInit {
  private t = inject(TranslationService);
  verifyForm: FormGroup;
  isLoading = false;
  isResending = false;
  errorMessage: string | null = null;

  constructor(
    private fb: FormBuilder,
    private route: ActivatedRoute,
    private authService: AuthService,
    private navCtrl: NavController,
    private toastCtrl: ToastController,
  ) {
    this.verifyForm = this.fb.group({
      identifier: ['', [Validators.required]],
      code: ['', [Validators.required, Validators.minLength(6), Validators.maxLength(6)]],
    });
  }

  async ngOnInit(): Promise<void> {
    // Sign-up redirects here with the identifier it just used. Links sent
    // before the switch to codes carry an ?email= instead, so they land on this
    // form and the recipient only has to ask for a new code.
    const identifier =
      this.route.snapshot.queryParamMap.get('identifier') ||
      this.route.snapshot.queryParamMap.get('email');
    if (identifier) {
      this.verifyForm.patchValue({ identifier });
    }

    const config = await firstValueFrom(this.authService.getConfig());
    this.verifyForm
      .get('identifier')
      ?.addValidators(identifierValidator(config?.default_phone_region));
  }

  get identifier(): string {
    return this.verifyForm.get('identifier')?.value || '';
  }

  get knownIdentifier(): boolean {
    const params = this.route.snapshot.queryParamMap;
    return !!(params.get('identifier') || params.get('email'));
  }

  submitCode(): void {
    if (this.verifyForm.invalid) {
      return;
    }

    this.isLoading = true;
    this.errorMessage = null;

    this.authService.verifyAccountCode({
      identifier: this.identifier,
      code: this.verifyForm.get('code')?.value,
    }).subscribe({
      // Verifying signs the user in, so go straight on: FirstLoginGuard sends
      // a brand-new account to onboarding to finish its profile.
      next: () => this.navCtrl.navigateRoot('/home'),
      error: (error) => {
        this.isLoading = false;
        this.errorMessage =
          error.error?.detail || this.t.instant('verifyAccount.invalidCode');
      },
    });
  }

  resendCode(): void {
    if (this.isResending || this.verifyForm.get('identifier')?.invalid) {
      return;
    }

    this.isResending = true;
    this.errorMessage = null;

    this.authService.resendVerificationCode(this.identifier).subscribe({
      next: async () => {
        this.isResending = false;
        this.verifyForm.get('code')?.reset();
        const toast = await this.toastCtrl.create({
          message: this.t.instant('verifyAccount.codeSent'),
          duration: 2000,
          position: 'top',
          color: 'success',
        });
        await toast.present();
      },
      error: async () => {
        this.isResending = false;
        const toast = await this.toastCtrl.create({
          message: this.t.instant('verifyAccount.sendFailed'),
          duration: 2000,
          position: 'top',
          color: 'danger',
        });
        await toast.present();
      },
    });
  }

  goToLogin(): void {
    this.navCtrl.navigateRoot('/login');
  }
}
