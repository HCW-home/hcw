import { Component, OnInit, inject } from "@angular/core";
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
  NavController,
  LoadingController,
  ToastController,
} from "@ionic/angular/standalone";
import { TranslatePipe } from "@ngx-translate/core";
import { AuthService } from "../../core/services/auth.service";
import { TranslationService } from "../../core/services/translation.service";
import { LanguageSelectorComponent } from "../../shared/components/language-selector/language-selector.component";
import { AuthBrandingComponent } from '../../shared/components/auth-branding/auth-branding.component';
import { ActivatedRoute } from "@angular/router";

@Component({
  selector: "app-register",
  templateUrl: "./register.page.html",
  styleUrls: ["./register.page.scss"],
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    IonContent,
    IonItem,
    IonInput,
    IonButton,
    IonIcon,
    IonText,
    TranslatePipe,
    LanguageSelectorComponent, AuthBrandingComponent],
})
export class RegisterPage implements OnInit {
  private t = inject(TranslationService);
  registerForm: FormGroup;
  showPassword = false;
  showConfirmPassword = false;
  registrationEnabled = true;
  loading = true;

  constructor(
    private fb: FormBuilder,
    private authService: AuthService,
    private navCtrl: NavController,
    private loadingCtrl: LoadingController,
    private toastCtrl: ToastController,
    private route: ActivatedRoute,
  ) {
    this.registerForm = this.fb.group(
      {
        first_name: ["", [Validators.required, Validators.minLength(2)]],
        last_name: ["", [Validators.required, Validators.minLength(2)]],
        email: ["", [Validators.required, Validators.email]],
        password1: ["", [Validators.required, Validators.minLength(8)]],
        password2: ["", [Validators.required]],
      },
      { validators: this.passwordMatchValidator },
    );
  }

  private returnAction: string | null = null;

  ngOnInit() {
    this.returnAction = this.route.snapshot.queryParamMap.get('action');

    this.authService.getConfig().subscribe({
        // getConfig() emits null when the backend is unreachable.
      next: (config: any) => {
        this.registrationEnabled =
          !!config?.registration_enabled && !config?.force_temporary_patients;
        this.loading = false;
      },
      error: () => {
        this.registrationEnabled = false;
        this.loading = false;
      },
    });
  }

  passwordMatchValidator(form: FormGroup) {
    const password = form.get("password1");
    const confirmPassword = form.get("password2");
    if (
      password &&
      confirmPassword &&
      password.value !== confirmPassword.value
    ) {
      confirmPassword.setErrors({ passwordMismatch: true });
      return { passwordMismatch: true };
    }
    return null;
  }

  togglePassword() {
    this.showPassword = !this.showPassword;
  }

  toggleConfirmPassword() {
    this.showConfirmPassword = !this.showConfirmPassword;
  }

  async onRegister() {
    if (this.registerForm.valid) {
      const loading = await this.loadingCtrl.create({
        message: this.t.instant('register.creatingAccount'),
        spinner: "crescent",
      });
      await loading.present();

      this.authService.register(this.registerForm.value).subscribe({
        next: async () => {
          await loading.dismiss();
          // The code was mailed out: send the user straight to where they
          // type it in, carrying the address so they need not retype it.
          this.navCtrl.navigateRoot(["/verify-email"], {
            queryParams: { email: this.registerForm.value.email },
          });
        },
        error: async (error) => {
          await loading.dismiss();
          let errorMessage = this.t.instant('register.registrationFailed');
          if (error.error) {
            if (error.error.email) {
              errorMessage = error.error.email[0];
            } else if (error.error.username) {
              errorMessage = error.error.username[0];
            } else if (error.error.password1) {
              errorMessage = error.error.password1[0];
            } else if (error.error.non_field_errors) {
              errorMessage = error.error.non_field_errors[0];
            }
          }
          const toast = await this.toastCtrl.create({
            message: errorMessage,
            duration: 3000,
            position: "top",
            color: "danger",
          });
          await toast.present();
        },
      });
    }
  }

  goToLogin() {
    if (this.returnAction) {
      this.navCtrl.navigateBack("/login", {
        queryParams: {
          action: this.returnAction
        }
      });
    } else {
      this.navCtrl.navigateBack("/login");
    }
  }
}
