import { Component, OnInit } from '@angular/core';
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
  selector: 'app-register',
  templateUrl: './register.page.html',
  styleUrls: ['./register.page.scss'],
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
export class RegisterPage implements OnInit {
  registerForm: FormGroup;
  showPassword = false;
  showConfirmPassword = false;

  constructor(
    private fb: FormBuilder,
    private authService: AuthService,
    private navCtrl: NavController,
    private loadingCtrl: LoadingController,
    private toastCtrl: ToastController
  ) {
    this.registerForm = this.fb.group({
      first_name: ['', [Validators.required, Validators.minLength(2)]],
      last_name: ['', [Validators.required, Validators.minLength(2)]],
      email: ['', [Validators.required, Validators.email]],
      username: ['', [Validators.required, Validators.minLength(3)]],
      password1: ['', [Validators.required, Validators.minLength(8)]],
      password2: ['', [Validators.required]]
    }, { validators: this.passwordMatchValidator });
  }

  ngOnInit() {}

  passwordMatchValidator(form: FormGroup) {
    const password = form.get('password1');
    const confirmPassword = form.get('password2');
    if (password && confirmPassword && password.value !== confirmPassword.value) {
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
        message: 'Creating account...',
        spinner: 'crescent'
      });
      await loading.present();

      this.authService.register(this.registerForm.value).subscribe({
        next: async () => {
          await loading.dismiss();
          const toast = await this.toastCtrl.create({
            message: 'Account created successfully! Please log in.',
            duration: 3000,
            position: 'top',
            color: 'success'
          });
          await toast.present();
          this.navCtrl.navigateBack('/login');
        },
        error: async (error) => {
          await loading.dismiss();
          let errorMessage = 'Registration failed. Please try again.';
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
            position: 'top',
            color: 'danger'
          });
          await toast.present();
        }
      });
    }
  }

  goToLogin() {
    this.navCtrl.navigateBack('/login');
  }
}
