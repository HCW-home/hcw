import { Component, OnInit } from '@angular/core';
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
import { AuthService } from '../../core/services/auth.service';

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
  ]
})
export class VerifyEmailPage implements OnInit {
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
      this.errorMessage = 'Invalid or missing verification link.';
      return;
    }

    this.authService.verifyEmail(token).subscribe({
      next: () => {
        this.isLoading = false;
        this.success = true;
      },
      error: (error) => {
        this.isLoading = false;
        this.errorMessage = error.error?.detail || 'Email verification failed. The link may be invalid or expired.';
      },
    });
  }

  goToLogin(): void {
    this.navCtrl.navigateRoot('/login');
  }
}
