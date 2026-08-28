import {
  Component,
  EventEmitter,
  Input,
  OnChanges,
  OnInit,
  Output,
  SimpleChanges,
  ViewChild,
  inject,
} from '@angular/core';
import {
  FormBuilder,
  FormGroup,
  ReactiveFormsModule,
  Validators,
} from '@angular/forms';
import {
  IonButton,
  IonIcon,
  IonInput,
  IonItem,
  IonSpinner,
  IonText,
  LoadingController,
  ToastController,
} from '@ionic/angular/standalone';
import { TranslatePipe } from '@ngx-translate/core';
import { Observable } from 'rxjs';

import { AuthService } from '../../../core/services/auth.service';
import { TranslationService } from '../../../core/services/translation.service';
import { identifierValidator } from '../../tools/identifier';

export type AuthFormMode = 'login' | 'register';

/**
 * Sign in / sign up form, without any page chrome.
 *
 * Both flows end on the same verification code step, so the booking wizard can
 * host it as one of its steps instead of sending the user off to /login and
 * back. Hosts decide what to do once the session is open, and where the
 * "forgot password" link leads.
 */
@Component({
  selector: 'app-auth-form',
  templateUrl: './auth-form.component.html',
  styleUrls: ['./auth-form.component.scss'],
  standalone: true,
  imports: [
    ReactiveFormsModule,
    IonItem,
    IonInput,
    IonButton,
    IonIcon,
    IonText,
    IonSpinner,
    TranslatePipe,
  ],
})
export class AuthFormComponent implements OnInit, OnChanges {
  @Input() mode: AuthFormMode = 'login';
  @Input() initialIdentifier = '';
  // The host already knows the account: go past the identifier step on its own.
  @Input() autoContinue = false;
  // Offers "no account yet?" / "already registered?" under the form.
  @Input() showModeSwitch = true;

  @Output() authenticated = new EventEmitter<void>();
  @Output() modeChange = new EventEmitter<AuthFormMode>();
  @Output() forgotPassword = new EventEmitter<string>();

  private t = inject(TranslationService);

  @ViewChild('passwordInput') passwordInput!: IonInput;

  step: 'identifier' | 'credentials' | 'verification' = 'identifier';

  identifierForm: FormGroup;
  passwordForm: FormGroup;
  verificationForm: FormGroup;

  showPassword = false;
  registrationEnabled = false;
  passwordLoginDisabled = false;
  // Whether patients may authenticate with a password at all. Off by default:
  // they receive an email/SMS code instead.
  patientPasswordLoginEnabled = false;

  isLoading = false;
  isResending = false;
  errorMessage: string | null = null;

  private authToken: string | null = null;

  constructor(
    private fb: FormBuilder,
    private authService: AuthService,
    private loadingCtrl: LoadingController,
    private toastCtrl: ToastController,
  ) {
    this.identifierForm = this.fb.group({
      identifier: ['', [Validators.required]],
    });
    this.passwordForm = this.fb.group({
      password: ['', [Validators.required, Validators.minLength(6)]],
    });
    this.verificationForm = this.fb.group({
      verification_code: ['', [Validators.required, Validators.minLength(6), Validators.maxLength(6)]],
    });
  }

  get identifier(): string {
    return this.identifierForm.get('identifier')?.value || '';
  }

  /** Password login is email-only and has to be enabled for patients. */
  get canUsePasswordLogin(): boolean {
    return this.patientPasswordLoginEnabled && !this.passwordLoginDisabled;
  }

  ngOnInit(): void {
    if (this.initialIdentifier) {
      this.identifierForm.patchValue({ identifier: this.initialIdentifier });
    }

    this.authService.getConfig().subscribe({
      next: (config: any) => {
        // getConfig() emits null when the backend is unreachable; keep sane
        // defaults instead of throwing on null.property.
        if (config) {
          this.registrationEnabled =
            !!config.registration_enabled && !config.force_temporary_patients;
          this.passwordLoginDisabled = !!config.force_temporary_patients;
          this.patientPasswordLoginEnabled = !!config.enable_patient_password_login;
          this.identifierForm
            .get('identifier')
            ?.addValidators(identifierValidator(config.default_phone_region));
          if (this.passwordLoginDisabled) {
            this.passwordForm.get('password')?.disable({ emitEvent: false });
          }
        }

        if (this.autoContinue && this.identifierForm.valid) {
          this.onContinue();
        }
      },
    });
  }

  ngOnChanges(changes: SimpleChanges): void {
    // Switching between sign in and sign up restarts the flow, but the typed
    // identifier is worth keeping.
    if (changes['mode'] && !changes['mode'].firstChange) {
      this.resetToIdentifier();
    }
  }

  onContinue(): void {
    if (this.identifierForm.invalid) return;
    this.errorMessage = null;

    if (this.mode === 'register') {
      this.register();
      return;
    }

    if (this.canUsePasswordLogin && this.identifier.includes('@')) {
      this.step = 'credentials';
      setTimeout(() => this.passwordInput?.setFocus(), 300);
    } else {
      this.sendCode();
    }
  }

  resetToIdentifier(): void {
    this.step = 'identifier';
    this.errorMessage = null;
    this.passwordForm.reset();
    this.verificationForm.reset();
    this.authToken = null;
  }

  togglePassword(): void {
    this.showPassword = !this.showPassword;
  }

  switchTo(mode: AuthFormMode): void {
    this.modeChange.emit(mode);
  }

  onForgotPassword(): void {
    this.forgotPassword.emit(this.identifier);
  }

  async onLogin(): Promise<void> {
    if (this.identifierForm.invalid || this.passwordForm.invalid) return;

    const loading = await this.loadingCtrl.create({
      message: this.t.instant('login.loggingIn'),
      spinner: 'crescent',
    });
    await loading.present();

    this.authService.login({
      email: this.identifier,
      password: this.passwordForm.get('password')?.value,
    }).subscribe({
      next: async () => {
        await loading.dismiss();
        this.authenticated.emit();
      },
      error: async error => {
        await loading.dismiss();
        this.showError(error.error?.detail || this.t.instant('login.invalidCredentials'));
      },
    });
  }

  sendCode(): void {
    this.isLoading = true;
    this.errorMessage = null;

    this.authService.sendVerificationCode(this.identifier).subscribe({
      next: response => {
        this.isLoading = false;
        this.authToken = response.auth_token;
        this.step = 'verification';
      },
      error: error => {
        this.isLoading = false;
        this.showError(error.error?.error || this.t.instant('login.genericError'));
      },
    });
  }

  /** Creates the account, which sends the code the next step asks for. */
  private register(): void {
    this.isLoading = true;

    this.authService.register({ identifier: this.identifier }).subscribe({
      next: () => {
        this.isLoading = false;
        this.authToken = null;
        this.step = 'verification';
      },
      error: error => {
        this.isLoading = false;
        this.showError(this.registrationError(error));
      },
    });
  }

  private registrationError(error: any): string {
    const payload = error?.error;
    if (payload?.identifier) return payload.identifier[0];
    if (payload?.detail) return payload.detail;
    if (payload?.non_field_errors) return payload.non_field_errors[0];
    return this.t.instant('register.registrationFailed');
  }

  submitVerificationCode(): void {
    if (this.verificationForm.invalid) return;

    const code = this.verificationForm.get('verification_code')?.value;
    this.isLoading = true;
    this.errorMessage = null;

    // Signing up verifies the brand-new account; signing in exchanges the code
    // for a session against the token handed out with it.
    if (this.mode === 'register') {
      this.authService.verifyAccountCode({ identifier: this.identifier, code }).subscribe({
        next: () => {
          this.isLoading = false;
          this.authenticated.emit();
        },
        error: error => {
          this.isLoading = false;
          this.errorMessage =
            error.error?.detail || this.t.instant('verifyAccount.invalidCode');
        },
      });
      return;
    }

    if (!this.authToken) {
      this.isLoading = false;
      return;
    }

    this.authService.loginWithToken({
      auth_token: this.authToken,
      verification_code: code,
    }).subscribe({
      next: response => {
        this.isLoading = false;
        if (response.access && response.refresh) {
          this.authenticated.emit();
        }
      },
      error: error => {
        this.isLoading = false;
        if (error.status === 429) {
          this.errorMessage = error.error?.error || this.t.instant('login.tooManyAttempts');
        } else if (error.status === 401) {
          this.errorMessage = error.error?.error || this.t.instant('login.invalidVerificationCode');
        } else {
          this.errorMessage = this.t.instant('login.genericError');
        }
      },
    });
  }

  resendCode(): void {
    if (this.isResending) return;

    this.isResending = true;
    this.errorMessage = null;

    const request: Observable<any> = this.mode === 'register'
      ? this.authService.resendVerificationCode(this.identifier)
      : this.authService.sendVerificationCode(this.identifier);

    request.subscribe({
      next: async (response: any) => {
        this.isResending = false;
        if (response?.auth_token) {
          this.authToken = response.auth_token;
        }
        this.verificationForm.reset();
        const toast = await this.toastCtrl.create({
          message: this.t.instant('login.codeSent'),
          duration: 2000,
          position: 'top',
          color: 'success',
        });
        await toast.present();
      },
      error: () => {
        this.isResending = false;
        this.showError(this.t.instant('login.genericError'));
      },
    });
  }

  private async showError(message: string): Promise<void> {
    const toast = await this.toastCtrl.create({
      message,
      duration: 3000,
      position: 'top',
      color: 'danger',
    });
    await toast.present();
  }
}
