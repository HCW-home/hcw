import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute } from '@angular/router';
import {
  IonContent,
  IonIcon,
  IonText,
  IonButton,
  IonSpinner,
  NavController,
} from '@ionic/angular/standalone';
import { TranslatePipe } from '@ngx-translate/core';
import { AuthService } from '../../core/services/auth.service';
import { TranslationService } from '../../core/services/translation.service';

@Component({
  selector: 'app-verify-email',
  templateUrl: './verify-email.page.html',
  styleUrls: ['./verify-email.page.scss'],
  standalone: true,
  imports: [
    CommonModule,
    IonContent,
    IonIcon,
    IonText,
    IonButton,
    IonSpinner,
    TranslatePipe,
  ]
})
export class VerifyEmailPage implements OnInit {
  private t = inject(TranslationService);
  isLoading = true;
  success = false;
  errorMessage: string | null = null;

  constructor(
    private route: ActivatedRoute,
    private authService: AuthService,
    private navCtrl: NavController,
  ) {}

  ngOnInit(): void {
    const token = this.route.snapshot.queryParamMap.get('token');
    if (!token) {
      this.isLoading = false;
      this.errorMessage = this.t.instant('verifyEmail.invalidLink');
      return;
    }

    this.authService.verifyEmail(token).subscribe({
      next: () => {
        this.isLoading = false;
        this.success = true;
      },
      error: (error) => {
        this.isLoading = false;
        this.errorMessage = error.error?.detail || this.t.instant('verifyEmail.verificationFailed');
      },
    });
  }

  goToLogin(): void {
    this.navCtrl.navigateRoot('/login');
  }
}
