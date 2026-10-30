import { Component, inject, OnInit, OnDestroy } from '@angular/core';
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
import { TranslatePipe } from '@ngx-translate/core';
import { Subject, takeUntil } from 'rxjs';
import { AuthService } from '../../core/services/auth.service';
import { ActionHandlerService } from '../../core/services/action-handler.service';
import { TranslationService } from '../../core/services/translation.service';
import { LanguageSelectorComponent } from '../../shared/components/language-selector/language-selector.component';
import { AuthBrandingComponent } from '../../shared/components/auth-branding/auth-branding.component';
import { ResendCountdown, retryAfterSeconds } from '../../shared/tools/resend-countdown';

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
    IonSpinner,
    TranslatePipe,
    LanguageSelectorComponent, AuthBrandingComponent]
})
export class VerifyInvitePage implements OnInit, OnDestroy {
  private t = inject(TranslationService);
  private destroy$ = new Subject<void>();

  authToken: string | null = null;
  action: string | null = null;
  actionId: string | null = null;
  isLoading = true;
  requiresVerification = false;
  errorMessage: string | null = null;
  isResending = false;
  // Started as soon as the code is asked for, opening the link included.
  resendCountdown = new ResendCountdown();

  verificationForm: FormGroup;

  constructor(
    private fb: FormBuilder,
    private route: ActivatedRoute,
    private authService: AuthService,
    private navCtrl: NavController,
    private toastCtrl: ToastController,
    private actionHandler: ActionHandlerService
  ) {
    this.verificationForm = this.fb.group({
      verification_code: ['', [Validators.required, Validators.minLength(6), Validators.maxLength(6)]]
    });
  }

  ngOnInit(): void {
    // Load config
    this.authService.getConfig().pipe(takeUntil(this.destroy$)).subscribe({
      next: (config: any) => {      },
      error: (err: any) => console.error('Failed to load config', err)
    });

    this.authToken = this.route.snapshot.queryParamMap.get('auth');
    this.action = this.route.snapshot.queryParamMap.get('action');
    this.actionId = this.route.snapshot.queryParamMap.get('id');

    if (this.authToken) {
      this.authenticateWithToken();
    } else {
      this.isLoading = false;
      this.errorMessage = this.t.instant('verifyInvite.noAuthToken');
    }
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
    this.resendCountdown.stop();
  }

  private showCodeForm(): void {
    this.requiresVerification = true;
    this.resendCountdown.start();
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
            this.showCodeForm();
          } else if (response.error) {
            this.errorMessage = response.error;
          }
        },
        error: async (error) => {
          this.isLoading = false;
          if (error.status === 202) {
            this.showCodeForm();
          } else if (error.status === 401) {
            // Prefer the friendlier "link expired" wording; the backend
            // returns 401 with "Token expired" for stale magic links.
            const backendMessage: string | undefined = error.error?.error;
            const looksExpired = !backendMessage || /expired/i.test(backendMessage);
            this.errorMessage = looksExpired
              ? this.t.instant('verifyInvite.linkExpired')
              : this.t.instant('verifyInvite.invalidToken');
          } else {
            this.errorMessage = this.t.instant('verifyInvite.genericError');
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
          // The backend answers in English only; its `code` field tells an
          // expired code apart from a wrong one.
          // The form stays up so that a new code is one tap away.
          if (error.status === 429) {
            this.errorMessage = this.t.instant('verifyInvite.tooManyAttempts');
          } else if (error.error?.code === 'verification_code_expired') {
            this.errorMessage = this.t.instant('verifyInvite.codeExpired');
          } else if (error.status === 401) {
            this.errorMessage = this.t.instant('verifyInvite.invalidVerificationCode');
          } else {
            this.errorMessage = this.t.instant('verifyInvite.genericError');
          }
        }
      });
  }

  private async onAuthenticationSuccess(): Promise<void> {
    const toast = await this.toastCtrl.create({
      message: this.t.instant('verifyInvite.authSuccess'),
      duration: 2000,
      position: 'top',
      color: 'success'
    });
    await toast.present();

    this.actionHandler.navigateToAction(this.action, this.actionId);
  }

  resendVerificationCode(): void {
    if (!this.authToken || this.isResending || this.resendCountdown.running) {
      return;
    }

    this.isResending = true;
    this.errorMessage = null;

    this.authService.loginWithToken({ auth_token: this.authToken })
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: async (response) => {
          this.isResending = false;
          if (response.access && response.refresh) {
            this.onAuthenticationSuccess();
          } else {
            this.resendCountdown.start();
            await this.toast('verifyInvite.codeSent', 'success');
          }
        },
        error: async (error) => {
          this.isResending = false;
          if (error.status === 202) {
            this.resendCountdown.start();
            await this.toast('verifyInvite.codeSent', 'success');
          } else if (error.status === 429) {
            this.resendCountdown.start(retryAfterSeconds(error));
            await this.toast('verifyInvite.tooManyRequests', 'danger');
          } else {
            await this.toast('verifyInvite.resendFailed', 'danger');
          }
        }
      });
  }

  private async toast(key: string, color: 'success' | 'danger'): Promise<void> {
    const toast = await this.toastCtrl.create({
      message: this.t.instant(key),
      duration: 2000,
      position: 'top',
      color
    });
    await toast.present();
  }

  goToLogin(): void {
    this.navCtrl.navigateRoot('/login');
  }
}
