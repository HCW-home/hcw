import { Component, inject, OnInit } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { Auth } from '../../../../core/services/auth';
import { RoutePaths } from '../../../../core/constants/routes';
import { Typography } from '../../../../shared/ui-components/typography/typography';
import { TypographyTypeEnum } from '../../../../shared/constants/typography';

@Component({
  selector: 'app-openid-callback',
  imports: [Typography],
  templateUrl: './openid-callback.html',
  styleUrl: './openid-callback.scss',
})
export class OpenIdCallback implements OnInit {
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private authService = inject(Auth);

  errorMessage = '';
  isLoading = true;

  ngOnInit() {
    // Get authorization code from URL query parameters
    this.route.queryParams.subscribe(params => {
      const code = params['code'];
      const error = params['error'];
      const errorDescription = params['error_description'];

      if (error) {
        this.isLoading = false;
        this.errorMessage = errorDescription || error;
        console.error('OpenID authentication error:', error, errorDescription);
        setTimeout(() => {
          this.router.navigate([`/${RoutePaths.AUTH}`]);
        }, 3000);
        return;
      }

      if (code) {
        // Get PKCE verifier from localStorage
        const pkceVerifier = localStorage.getItem('pkce_verifier');

        // Exchange authorization code for JWT tokens
        this.authService.loginWithOpenID(code, pkceVerifier).subscribe({
          next: (response) => {
            // Store the JWT token
            this.authService.setToken(response.access);
            // Redirect to dashboard
            this.router.navigate([`/${RoutePaths.USER}`, RoutePaths.DASHBOARD]);
          },
          error: (err) => {
            this.isLoading = false;
            // Handle both error formats from backend
            this.errorMessage = err.error?.non_field_errors?.[0]
              || err.error?.detail
              || 'Authentication failed. Please try again.';
            console.error('OpenID token exchange error:', err);
            setTimeout(() => {
              this.router.navigate([`/${RoutePaths.AUTH}`]);
            }, 3000);
          }
        });
      } else {
        this.isLoading = false;
        this.errorMessage = 'No authorization code received';
        setTimeout(() => {
          this.router.navigate([`/${RoutePaths.AUTH}`]);
        }, 3000);
      }
    });
  }

  protected readonly TypographyTypeEnum = TypographyTypeEnum;
}
