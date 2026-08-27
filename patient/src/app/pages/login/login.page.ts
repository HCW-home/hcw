import { Component, OnInit, ViewChild, inject } from "@angular/core";
import { CommonModule } from "@angular/common";
import {
  FormBuilder,
  FormGroup,
  Validators,
  ReactiveFormsModule,
} from "@angular/forms";
import {
  IonContent,
  IonItem,
  IonInput,
  IonButton,
  IonIcon,
  IonText,
  IonSpinner,
  NavController,
  LoadingController,
  ToastController,
} from "@ionic/angular/standalone";
import { ActivatedRoute } from "@angular/router";
import { Capacitor } from "@capacitor/core";
import { TranslatePipe } from "@ngx-translate/core";
import { MobileAppService } from "../../core/services/mobile-app.service";
import { AuthService } from "../../core/services/auth.service";
import { identifierValidator } from "../../shared/tools/identifier";
import { TranslationService } from "../../core/services/translation.service";
import { ActionHandlerService } from "../../core/services/action-handler.service";
import { DeeplinkService } from "../../core/services/deeplink.service";
import { LanguageSelectorComponent } from "../../shared/components/language-selector/language-selector.component";
import { AuthBrandingComponent } from '../../shared/components/auth-branding/auth-branding.component';

@Component({
  selector: "app-login",
  templateUrl: "./login.page.html",
  styleUrls: ["./login.page.scss"],
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    TranslatePipe,
    IonContent,
    IonItem,
    IonInput,
    IonButton,
    IonIcon,
    IonText,
    IonSpinner,
    LanguageSelectorComponent, AuthBrandingComponent],
})
export class LoginPage implements OnInit {
  private t = inject(TranslationService);
  private mobileApp = inject(MobileAppService);
  private deeplinkService = inject(DeeplinkService);

  @ViewChild('passwordInput') passwordInput!: IonInput;

  step: 'identifier' | 'credentials' | 'verification' = 'identifier';

  identifierForm: FormGroup;
  passwordForm: FormGroup;
  verificationForm: FormGroup;

  showPassword = false;
  registrationEnabled = false;
  passwordLoginDisabled = false;
  // Invite web users to open the native app (only before they sign in, and
  // never inside the native app itself).
  showDeeplinkBanner = false;
  // Whether patients are allowed to authenticate with a password on the patient
  // app. Off by default: patients then receive an email/SMS code instead.
  patientPasswordLoginEnabled = false;
  // Native builds talk to the instance picked at first launch; let the user
  // switch away from it, otherwise a wrong URL locks them out of the app.
  isNative = Capacitor.isNativePlatform();
  activeHost = this.deeplinkService.getActiveHost();

  isLoading = false;
  isResending = false;
  errorMessage: string | null = null;

  private authToken: string | null = null;

  constructor(
    private fb: FormBuilder,
    private route: ActivatedRoute,
    private authService: AuthService,
    private actionHandler: ActionHandlerService,
    private navCtrl: NavController,
    private loadingCtrl: LoadingController,
    private toastCtrl: ToastController,
  ) {
    this.identifierForm = this.fb.group({
      identifier: ["", [Validators.required]],
    });
    this.passwordForm = this.fb.group({
      password: ["", [Validators.required, Validators.minLength(6)]],
    });
    this.verificationForm = this.fb.group({
      verification_code: ["", [Validators.required, Validators.minLength(6), Validators.maxLength(6)]],
    });
  }

  get identifier(): string {
    return this.identifierForm.get('identifier')?.value || '';
  }

  ngOnInit() {
    const email = this.route.snapshot.queryParamMap.get("email");
    const action = this.route.snapshot.queryParamMap.get("action");
    if (email) {
      this.identifierForm.patchValue({ identifier: email });
    }
    // Coming from a link received by mail/SMS: the recipient already knows
    // which account they own, so skip the first step. Depending on the config,
    // onContinue() then shows the password form or sends the code straight away.
    const skipEmailStep = !!email && !!action && this.identifierForm.valid;
    this.authService.getConfig().subscribe({
      next: (config: any) => {
        // getConfig() emits null when the backend is unreachable; guard so the
        // page renders sane defaults instead of throwing on null.property.
        if (!config) {
          if (skipEmailStep) {
            this.onContinue();
          }
          return;
        }
        this.registrationEnabled =
          !!config.registration_enabled && !config.force_temporary_patients;
        this.passwordLoginDisabled = !!config.force_temporary_patients;
        this.patientPasswordLoginEnabled = !!config.enable_patient_password_login;
        this.identifierForm
          .get('identifier')
          ?.addValidators(identifierValidator(config.default_phone_region));
        // Only offer the native app on a certified instance — deep-linking to
        // an uncertified one would fail.
        this.showDeeplinkBanner =
          !!config.enable_deeplink &&
          !!config.instance_certified &&
          !Capacitor.isNativePlatform();
        if (this.passwordLoginDisabled) {
          this.passwordForm.get('password')?.disable({ emitEvent: false });
        }
        if (config.languages?.length) {
          this.t.loadLanguages(config.languages);
        }
        if (skipEmailStep) {
          this.onContinue();
        }
      },
    });
  }

  changeServer(): void {
    this.deeplinkService.openPicker();
  }

  /** Open the current instance in the native app (see MobileAppService). */
  openInApp(): void {
    this.mobileApp.openInApp();
  }

  /** Password login is offered only when enabled for patients and the account
   *  is not forced to be a temporary (passwordless) one. */
  get canUsePasswordLogin(): boolean {
    return this.patientPasswordLoginEnabled && !this.passwordLoginDisabled;
  }

  onContinue() {
    if (this.identifierForm.invalid) {
      return;
    }
    this.errorMessage = null;
    // Password login is email-only on the API side, so someone signing in with
    // a phone number goes straight to the code, whatever the instance allows.
    if (this.canUsePasswordLogin && this.identifier.includes('@')) {
      this.step = 'credentials';
      setTimeout(() => this.passwordInput?.setFocus(), 300);
    } else {
      this.sendCode();
    }
  }

  goBack() {
    this.step = 'identifier';
    this.errorMessage = null;
    this.passwordForm.reset();
    this.verificationForm.reset();
    this.authToken = null;
  }

  togglePassword() {
    this.showPassword = !this.showPassword;
  }

  async onLogin() {
    if (this.identifierForm.invalid || this.passwordForm.invalid) {
      return;
    }

    const loading = await this.loadingCtrl.create({
      message: this.t.instant('login.loggingIn'),
      spinner: "crescent",
    });
    await loading.present();

    const credentials = {
      email: this.identifier,
      password: this.passwordForm.get('password')?.value,
    };

    this.authService.login(credentials).subscribe({
      next: async () => {
        await loading.dismiss();
        this.navigateAfterAuth();
      },
      error: async (error) => {
        await loading.dismiss();
        const toast = await this.toastCtrl.create({
          message: error.error?.detail || this.t.instant('login.invalidCredentials'),
          duration: 3000,
          position: "top",
          color: "danger",
        });
        await toast.present();
      },
    });
  }

  sendCode() {
    this.isLoading = true;
    this.errorMessage = null;

    this.authService.sendVerificationCode(this.identifier).subscribe({
      next: (response) => {
        this.isLoading = false;
        this.authToken = response.auth_token;
        this.step = 'verification';
      },
      error: async (error) => {
        this.isLoading = false;
        const toast = await this.toastCtrl.create({
          message: error.error?.error || this.t.instant('login.genericError'),
          duration: 3000,
          position: "top",
          color: "danger",
        });
        await toast.present();
      },
    });
  }

  submitVerificationCode() {
    if (this.verificationForm.invalid || !this.authToken) {
      return;
    }

    this.isLoading = true;
    this.errorMessage = null;

    const verificationCode = this.verificationForm.get('verification_code')?.value;

    this.authService.loginWithToken({
      auth_token: this.authToken,
      verification_code: verificationCode,
    }).subscribe({
      next: (response) => {
        this.isLoading = false;
        if (response.access && response.refresh) {
          this.navigateAfterAuth();
        }
      },
      error: (error) => {
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

  resendCode() {
    if (this.isResending) {
      return;
    }

    this.isResending = true;
    this.errorMessage = null;

    this.authService.sendVerificationCode(this.identifier).subscribe({
      next: async (response) => {
        this.isResending = false;
        this.authToken = response.auth_token;
        this.verificationForm.reset();
        const toast = await this.toastCtrl.create({
          message: this.t.instant('login.codeSent'),
          duration: 2000,
          position: "top",
          color: "success",
        });
        await toast.present();
      },
      error: async () => {
        this.isResending = false;
        const toast = await this.toastCtrl.create({
          message: this.t.instant('login.genericError'),
          duration: 2000,
          position: "top",
          color: "danger",
        });
        await toast.present();
      },
    });
  }

  private navigateAfterAuth() {
    const action = this.route.snapshot.queryParamMap.get("action");
    const id = this.route.snapshot.queryParamMap.get("id");

    if (action) {
      this.actionHandler.navigateToAction(action, id);
    } else {
      this.navCtrl.navigateRoot("/home");
    }
  }

  goToRegister() {
    this.navCtrl.navigateForward("/register");
  }

  forgotPassword(): void {
    this.navCtrl.navigateForward("/forgot-password", { queryParams: { email: this.identifier } });
  }
}
