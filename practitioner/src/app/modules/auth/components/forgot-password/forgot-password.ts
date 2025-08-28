import { Component, inject } from '@angular/core';
import { Input } from '../../../../shared/ui-components/input/input';
import { Button } from '../../../../shared/ui-components/button/button';
import { TypographyTypeEnum } from '../../../../shared/constants/typography';
import { Typography } from '../../../../shared/ui-components/typography/typography';
import {
  ButtonTypeEnum,
  ButtonStyleEnum,
} from '../../../../shared/constants/button';
import { Router, RouterLink } from '@angular/router';
import { RoutePaths } from '../../../../core/constants/routes';
import {
  FormBuilder,
  FormControl,
  FormGroup,
  ReactiveFormsModule,
  Validators,
} from '@angular/forms';
import { AdminAuth } from '../../../../core/services/admin-auth';
import { ToasterService } from '../../../../core/services/toaster.service';
import { ValidationService } from '../../../../core/services/validation.service';

interface ForgotPasswordForm {
  email: FormControl<string>;
}

@Component({
  selector: 'app-forgot-password',
  imports: [Button, Input, Typography, RouterLink, ReactiveFormsModule],
  templateUrl: './forgot-password.html',
  styleUrl: './forgot-password.scss',
})
export class ForgotPassword {
  loadingButton = false;
  private router = inject(Router);
  private formBuilder = inject(FormBuilder);
  private toaster = inject(ToasterService);
  private adminAuthService = inject(AdminAuth);
  public validationService = inject(ValidationService);

  form: FormGroup<ForgotPasswordForm> = this.formBuilder.nonNullable.group({
    email: ['', [Validators.required, Validators.email]],
  });

  onSubmit() {
    if (this.form.valid) {
      this.loadingButton = true;
      const value = this.form.getRawValue();
      const body = {
        email: value.email,
      };
      this.adminAuthService.forgotPassword(body).subscribe({
        next: () => {
          this.loadingButton = false;
          this.toaster.show(
            'success',
            'Check Your Email',
            "If the email address provided matches an active account in our system, you'll receive a link  containing a verification code."
          );
          this.router.navigate([`/${RoutePaths.AUTH}`]);
        },
        error: err => {
          this.loadingButton = false;
          this.toaster.show('error', 'Error!', err.message);
        },
      });
    } else {
      this.validationService.validateAllFormFields(this.form);
    }
  }

  getErrorMessage(field: string): string {
    switch (field) {
      case 'email':
        if (this.form.get('email')?.errors?.['required']) {
          return 'Field is required';
        } else {
          return 'Invalid email address';
        }
      default:
        return '';
    }
  }

  protected readonly TypographyTypeEnum = TypographyTypeEnum;
  protected readonly ButtonTypeEnum = ButtonTypeEnum;
  protected readonly ButtonStyleEnum = ButtonStyleEnum;
  protected readonly RoutePaths = RoutePaths;
}
