import { Component, inject, OnInit } from '@angular/core';
import { Typography } from '../../../../shared/ui-components/typography/typography';
import { TypographyTypeEnum } from '../../../../shared/constants/typography';
import { Input } from '../../../../shared/ui-components/input/input';
import { Button } from '../../../../shared/ui-components/button/button';
import {
  ButtonStyleEnum,
  ButtonTypeEnum,
} from '../../../../shared/constants/button';
import { Router, RouterLink } from '@angular/router';
import { RoutePaths } from '../../../../core/constants/routes';
import {
  FormGroup,
  Validators,
  FormBuilder,
  FormControl,
  ReactiveFormsModule,
} from '@angular/forms';
import { ValidationService } from '../../../../core/services/validation.service';
import { Auth } from '../../../../core/services/auth';
import { ErrorMessage } from '../../../../shared/components/error-message/error-message';
import { getErrorMessage as getHttpErrorMessage } from '../../../../core/utils/error-helper';

interface LoginForm {
  email: FormControl<string>;
  password: FormControl<string>;
}

@Component({
  selector: 'app-login',
  imports: [
    Input,
    Button,
    Typography,
    RouterLink,
    ErrorMessage,
    ReactiveFormsModule,
  ],
  templateUrl: './login.html',
  styleUrl: './login.scss',
})
export class Login implements OnInit {
  errorMessage = '';
  loadingButton = false;
  openIdEnabled = false;
  openIdProviderName = '';
  private router = inject(Router);
  private formBuilder = inject(FormBuilder);
  private adminAuthService = inject(Auth);
  public validationService = inject(ValidationService);
  form: FormGroup<LoginForm> = this.formBuilder.nonNullable.group({
    email: ['info@iabsis.com', [Validators.required, Validators.email]],
    password: ['nHVih82Umdv@Qtk', [Validators.required]],
  });

  constructor() {
    this.form.valueChanges.subscribe(() => {
      this.errorMessage = '';
    });
  }

  ngOnInit() {
    // Check if OpenID Connect is enabled
    this.adminAuthService.getOpenIDConfig().subscribe({
      next: (config) => {
        this.openIdEnabled = config.enabled;
        this.openIdProviderName = config.provider_name || 'OpenID';
      },
      error: (err) => {
        console.error('Failed to get OpenID config:', err);
        this.openIdEnabled = false;
      }
    });
  }

  onSubmit() {
    if (this.form.valid) {
      this.loadingButton = true;
      const value = this.form.getRawValue();
      const body = {
        email: value.email,
        password: value.password,
      };
      this.adminAuthService.login(body).subscribe({
        next: (res) => {
          localStorage.setItem('token', res.access)
          this.router.navigate([`/${RoutePaths.USER}`, RoutePaths.DASHBOARD]);
          this.loadingButton = false;
        },
        error: err => {
          this.loadingButton = false;
          this.errorMessage = getHttpErrorMessage(err);
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
        return 'Field is required';
    }
  }

  onOpenIDLogin() {
    // Initiate OpenID Connect login flow
    this.adminAuthService.initiateOpenIDLogin();
  }

  protected readonly TypographyTypeEnum = TypographyTypeEnum;
  protected readonly ButtonTypeEnum = ButtonTypeEnum;
  protected readonly ButtonStyleEnum = ButtonStyleEnum;
  protected readonly RoutePaths = RoutePaths;
}
