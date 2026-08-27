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
import { AuthService } from '../../core/services/auth.service';
import { TranslationService } from '../../core/services/translation.service';
import { AuthBrandingComponent } from '../../shared/components/auth-branding/auth-branding.component';
import { LanguageSelectorComponent } from '../../shared/components/language-selector/language-selector.component';

@Component({
  selector: 'app-verify-email',
  templateUrl: './verify-email.page.html',
  styleUrls: ['./verify-email.page.scss'],
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
export class VerifyEmailPage implements OnInit {
  private t = inject(TranslationService);
  verifyForm: FormGroup;
  isLoading = false;
  isResending = false;
  success = false;
  errorMessage: string | null = null;

  constructor(
    private fb: FormBuilder,
    private route: ActivatedRoute,
    private authService: AuthService,
    private navCtrl: NavController,
    private toastCtrl: ToastController,
  ) {
    this.verifyForm = this.fb.group({
      email: ['', [Validators.required, Validators.email]],
      code: ['', [Validators.required, Validators.minLength(6), Validators.maxLength(6)]],
    });
  }

  ngOnInit(): void {
    // Registration redirects here with the address it just created. Links sent
    // before the switch to codes carry it too, so they land on this form
    // instead of an error and the recipient only has to ask for a new code.
    const email = this.route.snapshot.queryParamMap.get('email');
    if (email) {
      this.verifyForm.patchValue({ email });
    }
  }

  get email(): string {
    return this.verifyForm.get('email')?.value || '';
  }

  get knownEmail(): boolean {
    return !!this.route.snapshot.queryParamMap.get('email');
  }

  submitCode(): void {
    if (this.verifyForm.invalid) {
      return;
    }

    this.isLoading = true;
    this.errorMessage = null;

    this.authService.verifyEmailCode({
      email: this.email,
      code: this.verifyForm.get('code')?.value,
    }).subscribe({
      next: () => {
        this.isLoading = false;
        this.success = true;
      },
      error: (error) => {
        this.isLoading = false;
        this.errorMessage =
          error.error?.detail || this.t.instant('verifyEmail.invalidCode');
      },
    });
  }

  resendCode(): void {
    if (this.isResending || this.verifyForm.get('email')?.invalid) {
      return;
    }

    this.isResending = true;
    this.errorMessage = null;

    this.authService.resendVerificationEmail(this.email).subscribe({
      next: async () => {
        this.isResending = false;
        this.verifyForm.get('code')?.reset();
        const toast = await this.toastCtrl.create({
          message: this.t.instant('verifyEmail.codeSent'),
          duration: 2000,
          position: 'top',
          color: 'success',
        });
        await toast.present();
      },
      error: async () => {
        this.isResending = false;
        const toast = await this.toastCtrl.create({
          message: this.t.instant('verifyEmail.verificationFailed'),
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
