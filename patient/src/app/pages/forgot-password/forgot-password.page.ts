import { Component, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, FormGroup, Validators, ReactiveFormsModule } from '@angular/forms';
import {
  IonContent,
  IonItem,
  IonLabel,
  IonInput,
  IonButton,
  IonIcon,
  IonText,
  IonSpinner,
  NavController,
  ToastController
} from '@ionic/angular/standalone';
import { Subject, takeUntil } from 'rxjs';
import { AuthService } from '../../core/services/auth.service';

@Component({
  selector: 'app-forgot-password',
  templateUrl: './forgot-password.page.html',
  styleUrls: ['./forgot-password.page.scss'],
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    IonContent,
    IonItem,
    IonLabel,
    IonInput,
    IonButton,
    IonIcon,
    IonText,
    IonSpinner
  ]
})
export class ForgotPasswordPage implements OnDestroy {
  private destroy$ = new Subject<void>();
  forgotPasswordForm: FormGroup;
  isLoading = false;

  constructor(
    private fb: FormBuilder,
    private authService: AuthService,
    private navCtrl: NavController,
    private toastCtrl: ToastController
  ) {
    this.forgotPasswordForm = this.fb.group({
      email: ['', [Validators.required, Validators.email]]
    });
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  async onSubmit(): Promise<void> {
    if (this.forgotPasswordForm.valid) {
      this.isLoading = true;
      const { email } = this.forgotPasswordForm.value;

      this.authService.forgotPassword({ email })
        .pipe(takeUntil(this.destroy$))
        .subscribe({
          next: async () => {
            this.isLoading = false;
            const toast = await this.toastCtrl.create({
              message: 'If an account exists with this email, you will receive a password reset link.',
              duration: 4000,
              position: 'top',
              color: 'success'
            });
            await toast.present();
            this.navCtrl.navigateBack('/login');
          },
          error: async () => {
            this.isLoading = false;
            const toast = await this.toastCtrl.create({
              message: 'Failed to send reset email. Please try again.',
              duration: 3000,
              position: 'top',
              color: 'danger'
            });
            await toast.present();
          }
        });
    }
  }

  goToLogin(): void {
    this.navCtrl.navigateBack('/login');
  }
}
