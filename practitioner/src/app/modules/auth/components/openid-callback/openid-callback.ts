import { Component, inject, OnInit } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { Auth } from '../../../../core/services/auth';
import { RoutePaths } from '../../../../core/constants/routes';
import { Typography } from '../../../../shared/ui-components/typography/typography';
import { TypographyTypeEnum } from '../../../../shared/constants/typography';
import { Loader } from '../../../../shared/components/loader/loader';

@Component({
  selector: 'app-openid-callback',
  imports: [Typography, Loader],
  templateUrl: './openid-callback.html',
  styleUrl: './openid-callback.scss',
})
export class OpenIdCallback implements OnInit {
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private authService = inject(Auth);

  errorMessage = '';
  isLoading = true;

  ngOnInit(): void {
    this.route.queryParams.subscribe(params => {
      const code = params['code'];
      const state = params['state'];
      const error = params['error'];
      const errorDescription = params['error_description'];

      if (error) {
        this.handleError(errorDescription || error);
        return;
      }

      const savedState = sessionStorage.getItem('openid_state');
      sessionStorage.removeItem('openid_state');

      if (!state || state !== savedState) {
        this.handleError('Invalid state parameter. Please try again.');
        return;
      }

      if (code) {
        this.authService.loginWithOpenID(code).subscribe({
          next: (response) => {
            this.authService.setToken(response.access);
            localStorage.setItem('refreshToken', response.refresh);
            this.router.navigate([`/${RoutePaths.USER}`, RoutePaths.DASHBOARD]);
          },
          error: (err) => {
            const message = err.error?.non_field_errors?.[0]
              || err.error?.detail
              || 'Authentication failed. Please try again.';
            this.handleError(message);
          }
        });
      } else {
        this.handleError('No authorization code received');
      }
    });
  }

  private handleError(message: string): void {
    this.isLoading = false;
    this.errorMessage = message;
    setTimeout(() => {
      this.router.navigate([`/${RoutePaths.AUTH}`]);
    }, 3000);
  }

  protected readonly TypographyTypeEnum = TypographyTypeEnum;
}
