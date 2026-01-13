import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, FormGroup, Validators, ReactiveFormsModule } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';
import {
  IonContent,
  IonItem,
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
  selector: 'app-verify-invite',
  templateUrl: './verify-invite.page.html',
  styleUrls: ['./verify-invite.page.scss'],
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
    IonSpinner
  ]
})
export class VerifyInvitePage implements OnInit, OnDestroy {
  private destroy$ = new Subject<void>();

  authToken: string | null = null;
  action: string | null = null;
  isLoading = true;
  requiresVerification = false;
  errorMessage: string | null = null;

  verificationForm: FormGroup;

  constructor(
    private fb: FormBuilder,
    private route: ActivatedRoute,
    private authService: AuthService,
    private navCtrl: NavController,
    private toastCtrl: ToastController
  ) {
    this.verificationForm = this.fb.group({
      verification_code: ['', [Validators.required, Validators.minLength(6), Validators.maxLength(6)]]
    });
  }

  ngOnInit(): void {
    this.authToken = this.route.snapshot.queryParamMap.get('auth');
    this.action = this.route.snapshot.queryParamMap.get('action');

    if (this.authToken) {
      this.authenticateWithToken();
    } else {
      this.isLoading = false;
      this.errorMessage = 'No authentication token provided';
    }
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  private authenticateWithToken(): void {
    this.isLoading = true;
    this.errorMessage = null;

    this.authService.loginWithToken({ auth_token: this.authToken! })
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (response) => {
          this.isLoading = false;
          if (response.access && response.refresh) {
            this.onAuthenticationSuccess();
          } else if (response.requires_verification) {
            this.requiresVerification = true;
          } else if (response.error) {
            this.errorMessage = response.error;
          }
        },
        error: async (error) => {
          this.isLoading = false;
          if (error.status === 202) {
            this.requiresVerification = true;
          } else if (error.status === 401) {
            this.errorMessage = error.error?.error || 'Invalid or expired authentication token';
          } else {
            this.errorMessage = 'An error occurred. Please try again.';
          }
        }
      });
  }

  submitVerificationCode(): void {
    if (this.verificationForm.invalid || !this.authToken) {
      return;
    }

    this.isLoading = true;
    this.errorMessage = null;

    const verificationCode = this.verificationForm.get('verification_code')?.value;

    this.authService.loginWithToken({
      auth_token: this.authToken,
      verification_code: verificationCode
    })
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (response) => {
          this.isLoading = false;
          if (response.access && response.refresh) {
            this.onAuthenticationSuccess();
          } else if (response.error) {
            this.errorMessage = response.error;
          }
        },
        error: async (error) => {
          this.isLoading = false;
          if (error.status === 401) {
            this.errorMessage = error.error?.error || 'Invalid verification code';
          } else {
            this.errorMessage = 'An error occurred. Please try again.';
          }
        }
      });
  }

  private async onAuthenticationSuccess(): Promise<void> {
    const toast = await this.toastCtrl.create({
      message: 'Successfully authenticated',
      duration: 2000,
      position: 'top',
      color: 'success'
    });
    await toast.present();

    if (this.action === 'presence') {
      this.navCtrl.navigateRoot('/confirm-presence');
    } else if (this.action === 'join') {
      this.navCtrl.navigateRoot('/appointments');
    } else {
      this.navCtrl.navigateRoot('/home');
    }
  }

  goToLogin(): void {
    this.navCtrl.navigateRoot('/login');
  }
}
