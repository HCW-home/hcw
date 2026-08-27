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
import { identifierValidator } from "../../shared/tools/identifier";

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
  registrationEnabled = true;
  loading = true;
  /** Action carried over from a link, replayed after signing in. */
  returnAction: string | null = null;

  constructor(
    private fb: FormBuilder,
    private authService: AuthService,
    private navCtrl: NavController,
    private loadingCtrl: LoadingController,
    private toastCtrl: ToastController,
    private route: ActivatedRoute,
  ) {
    this.registerForm = this.fb.group({
      identifier: ["", [Validators.required]],
    });
  }

  ngOnInit() {
    this.returnAction = this.route.snapshot.queryParamMap.get('action');

    this.authService.getConfig().subscribe({
        // getConfig() emits null when the backend is unreachable.
      next: (config: any) => {
        this.registrationEnabled =
          !!config?.registration_enabled && !config?.force_temporary_patients;
        this.registerForm
          .get('identifier')
          ?.addValidators(identifierValidator(config?.default_phone_region));
        this.loading = false;
      },
      error: () => {
        this.registrationEnabled = false;
        this.loading = false;
      },
    });
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
          // The code is on its way: send the user straight to where they type
          // it in, carrying the identifier so they need not retype it.
          this.navCtrl.navigateRoot(["/verify"], {
            queryParams: { identifier: this.registerForm.value.identifier },
          });
        },
        error: async (error) => {
          await loading.dismiss();
          let errorMessage = this.t.instant('register.registrationFailed');
          if (error.error) {
            if (error.error.identifier) {
              errorMessage = error.error.identifier[0];
            } else if (error.error.detail) {
              errorMessage = error.error.detail;
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
