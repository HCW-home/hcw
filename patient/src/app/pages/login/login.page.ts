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
import { environment } from "../../../environments/environment";
import { AuthService } from "../../core/services/auth.service";
import { TranslationService } from "../../core/services/translation.service";
import { ActionHandlerService } from "../../core/services/action-handler.service";
import { ConsultationService } from "../../core/services/consultation.service";
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

  @ViewChild('passwordInput') passwordInput!: IonInput;

  step: 'email' | 'credentials' | 'verification' = 'email';

  emailForm: FormGroup;
  passwordForm: FormGroup;
  verificationForm: FormGroup;

  showPassword = false;
  registrationEnabled = false;
  passwordLoginDisabled = false;
  // Invite web users to open the native app (only before they sign in, and
  // never inside the native app itself).
  showDeeplinkBanner = false;
  // Mobile app identifiers served by the backend /config (env default, with a
  // per-instance Constance override). Used by openInApp() for store fallback.
  private mobileAndroidPackage = '';
  private mobileAndroidStoreUrl = '';
  private mobileIosStoreUrl = '';
  // Whether patients are allowed to authenticate with a password on the patient
  // app. Off by default: patients then receive an email/SMS code instead.
  patientPasswordLoginEnabled = false;

  isLoading = false;
  isResending = false;
  errorMessage: string | null = null;

  private authToken: string | null = null;

  constructor(
    private fb: FormBuilder,
    private route: ActivatedRoute,
    private authService: AuthService,
    private actionHandler: ActionHandlerService,
    private consultationService: ConsultationService,
    private navCtrl: NavController,
    private loadingCtrl: LoadingController,
    private toastCtrl: ToastController,
  ) {
    this.emailForm = this.fb.group({
      email: ["", [Validators.required, Validators.email]],
    });
    this.passwordForm = this.fb.group({
      password: ["", [Validators.required, Validators.minLength(6)]],
    });
    this.verificationForm = this.fb.group({
      verification_code: ["", [Validators.required, Validators.minLength(6), Validators.maxLength(6)]],
    });
  }

  get email(): string {
    return this.emailForm.get('email')?.value || '';
  }

  ngOnInit() {
    const email = this.route.snapshot.queryParamMap.get("email");
    if (email) {
      this.emailForm.patchValue({ email });
    }
    this.authService.getConfig().subscribe({
      next: (config: any) => {
        // getConfig() emits null when the backend is unreachable; guard so the
        // page renders sane defaults instead of throwing on null.property.
        if (!config) {
          return;
        }
        this.registrationEnabled =
          !!config.registration_enabled && !config.force_temporary_patients;
        this.passwordLoginDisabled = !!config.force_temporary_patients;
        this.patientPasswordLoginEnabled = !!config.enable_patient_password_login;
        this.showDeeplinkBanner = !!config.enable_deeplink && !Capacitor.isNativePlatform();
        this.mobileAndroidPackage = config.mobile_android_package || '';
        this.mobileAndroidStoreUrl = config.mobile_android_store_url || '';
        this.mobileIosStoreUrl = config.mobile_ios_store_url || '';
        if (this.passwordLoginDisabled) {
          this.passwordForm.get('password')?.disable({ emitEvent: false });
        }
        if (config.languages?.length) {
          this.t.loadLanguages(config.languages);
        }
      },
    });
  }

  /**
   * Open the current instance in the native app, falling back to the app store
   * when it isn't installed.
   *
   * There is no reliable web API to detect whether an app is installed:
   *  - Android: use an `intent://` URL. The OS opens the app if the scheme is
   *    registered, otherwise it follows S.browser_fallback_url to the Play
   *    Store — no fragile timers needed.
   *  - iOS: fire the custom-scheme deeplink and, if an App Store URL is
   *    configured, schedule a fallback redirect; it's cancelled by the tab
   *    losing focus when the app actually opens.
   *  - Other platforms: just fire the deeplink.
   *
   * Store URLs / package come from environment.mobileApp so they can be changed
   * per build without touching this code.
   */
  openInApp(): void {
    const host = window.location.host;
    const scheme = environment.mobileAppScheme;
    const deeplink = `${scheme}://${host}/home`;
    const ua = navigator.userAgent;

    if (/android/i.test(ua) && this.mobileAndroidPackage) {
      const fallback = this.mobileAndroidStoreUrl
        ? `S.browser_fallback_url=${encodeURIComponent(this.mobileAndroidStoreUrl)};`
        : '';
      // intent://<host>/home#Intent;scheme=<scheme>;package=<pkg>;S.browser_fallback_url=<store>;end
      window.location.href =
        `intent://${host}/home#Intent;scheme=${scheme};package=${this.mobileAndroidPackage};` +
        `${fallback}end`;
      return;
    }

    if (/iphone|ipad|ipod/i.test(ua) && this.mobileIosStoreUrl) {
      const fallbackTimer = setTimeout(() => {
        window.location.href = this.mobileIosStoreUrl;
      }, 1500);
      // If the app opens, the page is backgrounded — cancel the store redirect.
      const cancel = () => clearTimeout(fallbackTimer);
      window.addEventListener('pagehide', cancel, { once: true });
      window.addEventListener('blur', cancel, { once: true });
      window.location.href = deeplink;
      return;
    }

    window.location.href = deeplink;
  }

  /** Password login is offered only when enabled for patients and the account
   *  is not forced to be a temporary (passwordless) one. */
  get canUsePasswordLogin(): boolean {
    return this.patientPasswordLoginEnabled && !this.passwordLoginDisabled;
  }

  onContinue() {
    if (this.emailForm.invalid) {
      return;
    }
    this.errorMessage = null;
    if (this.canUsePasswordLogin) {
      this.step = 'credentials';
      setTimeout(() => this.passwordInput?.setFocus(), 300);
    } else {
      // No password login for patients: send the email/SMS code straight away.
      this.sendCode();
    }
  }

  goBack() {
    this.step = 'email';
    this.errorMessage = null;
    this.passwordForm.reset();
    this.verificationForm.reset();
    this.authToken = null;
  }

  togglePassword() {
    this.showPassword = !this.showPassword;
  }

  async onLogin() {
    if (this.emailForm.invalid || this.passwordForm.invalid) {
      return;
    }

    const loading = await this.loadingCtrl.create({
      message: this.t.instant('login.loggingIn'),
      spinner: "crescent",
    });
    await loading.present();

    const credentials = {
      email: this.email,
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

    this.authService.sendVerificationCode(this.email).subscribe({
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

    this.authService.sendVerificationCode(this.email).subscribe({
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

    if (action === "join" && id) {
      this.consultationService.getParticipantById(Number(id)).subscribe({
        next: (participant) => {
          const consultation = participant.appointment.consultation;
          const consultationId =
            typeof consultation === "object"
              ? (consultation as { id: number }).id
              : consultation;
          this.navCtrl.navigateRoot(
            `/consultation/${participant.appointment.id}/video`,
            { queryParams: { type: "appointment", consultationId } },
          );
        },
        error: () => {
          this.navCtrl.navigateRoot(`/confirm-presence/${id}`);
        },
      });
    } else if (action) {
      const actionRoute = this.actionHandler.getRouteWithParams(action, id);
      this.navCtrl.navigateRoot(actionRoute.path, { queryParams: actionRoute.queryParams });
    } else {
      this.navCtrl.navigateRoot("/home");
    }
  }

  goToRegister() {
    this.navCtrl.navigateForward("/register");
  }

  forgotPassword(): void {
    this.navCtrl.navigateForward("/forgot-password", { queryParams: { email: this.email } });
  }
}
