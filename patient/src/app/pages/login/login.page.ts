import { Component } from '@angular/core';
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
  NavController,
  LoadingController,
  ToastController
} from '@ionic/angular/standalone';
import { AuthService } from '../../core/services/auth.service';

@Component({
  selector: 'app-login',
  templateUrl: './login.page.html',
  styleUrls: ['./login.page.scss'],
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
    IonText
  ]
})
export class LoginPage {
  loginForm: FormGroup;
  showPassword = false;

  constructor(
    private fb: FormBuilder,
    private authService: AuthService,
    private navCtrl: NavController,
    private loadingCtrl: LoadingController,
    private toastCtrl: ToastController
  ) {
    this.loginForm = this.fb.group({
      email: ['patient@gmail.com', [Validators.required, Validators.email]],
      password: ['nHVih82Umdv@Qtk', [Validators.required, Validators.minLength(6)]]
    });
  }

  togglePassword() {
    this.showPassword = !this.showPassword;
  }

  async onLogin() {
    if (this.loginForm.valid) {
      const loading = await this.loadingCtrl.create({
        message: 'Logging in...',
        spinner: 'crescent'
      });
      await loading.present();

      this.authService.login(this.loginForm.value).subscribe({
        next: async (response) => {
          await loading.dismiss();
          this.navCtrl.navigateRoot('/home');
        },
        error: async (error) => {
          await loading.dismiss();
          const toast = await this.toastCtrl.create({
            message: error.error?.detail || 'Invalid credentials. Please try again.',
            duration: 3000,
            position: 'top',
            color: 'danger'
          });
          await toast.present();
        }
      });
    }
  }

  goToRegister() {
    this.navCtrl.navigateForward('/register');
  }

  forgotPassword(): void {
    this.navCtrl.navigateForward('/forgot-password');
  }

}
