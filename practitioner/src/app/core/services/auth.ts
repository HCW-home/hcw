import { inject, Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { BehaviorSubject, Observable, firstValueFrom } from 'rxjs';
import { SuccessResponse } from '../models/succesResponse';
import { environment } from '../../../environments/environment';
import {
  IBodyLogin,
  IResponseLogin,
  IBodySetPassword,
  IBodyForgotPassword,
  ITokenAuthRequest,
  ITokenAuthResponse,
} from '../models/admin-auth';

interface IOpenIDConfig {
  enabled: boolean;
  client_id: string | null;
  authorization_url: string | null;
  provider_name: string | null;
}

@Injectable({
  providedIn: 'root'
})
export class Auth {
  http: HttpClient = inject(HttpClient);
  private isAuthenticatedSubject = new BehaviorSubject<boolean>(this.isLoggedIn());
  public isAuthenticated$: Observable<boolean> = this.isAuthenticatedSubject.asObservable();

  isLoggedIn(): boolean {
    return !!localStorage.getItem("token");
  }

  getToken(): string | null {
    return localStorage.getItem("token");
  }

  setToken(token: string): void {
    localStorage.setItem("token", token);
    this.isAuthenticatedSubject.next(true);
  }

  removeToken(): void {
    localStorage.removeItem("token");
    this.isAuthenticatedSubject.next(false);
  }

  login(body: IBodyLogin): Observable<IResponseLogin> {
    return this.http.post<IResponseLogin>(`${environment.apiUrl}/auth/login/`, body);
  }

  forgotPassword(body: IBodyForgotPassword): Observable<SuccessResponse> {
    return this.http.post<SuccessResponse>(`${environment.apiUrl}/auth/password/reset/`, body);
  }

  setPassword(params: IBodySetPassword): Observable<SuccessResponse> {
    return this.http.post<SuccessResponse>(`${environment.apiUrl}/auth/password/reset/confirm/`, params);
  }

  loginWithToken(data: ITokenAuthRequest): Observable<ITokenAuthResponse> {
    return this.http.post<ITokenAuthResponse>(`${environment.apiUrl}/auth/token/`, data);
  }

  /**
   * Get OpenID Connect configuration from backend
   */
  getOpenIDConfig(): Observable<IOpenIDConfig> {
    return this.http.get<IOpenIDConfig>(`${environment.apiUrl}/auth/openid/config/`);
  }

  /**
   * Login with OpenID Connect authorization code
   * After user authenticates with OpenID provider, send the authorization code here
   */
  loginWithOpenID(authorizationCode: string, pkceVerifier: string | null = null): Observable<IResponseLogin> {
    const callbackUrl = `${window.location.origin}/auth/callback`;
    const body: any = {
      code: authorizationCode,
      callback_url: callbackUrl
    };

    // Add PKCE verifier if present
    if (pkceVerifier) {
      body.code_verifier = pkceVerifier;
    }

    return this.http.post<IResponseLogin>(`${environment.apiUrl}/auth/openid/`, body);
  }

  /**
   * Initiate OpenID Connect login flow
   * Fetches configuration from backend and redirects user to the OpenID provider login page
   */
  async initiateOpenIDLogin(): Promise<void> {
    try {
      // Fetch OpenID configuration from backend
      const config = await firstValueFrom(this.getOpenIDConfig());

      if (!config.enabled || !config.client_id || !config.authorization_url) {
        console.error('OpenID Connect is not properly configured');
        return;
      }

      // Get redirect URI (where user will return after OpenID authentication)
      const redirectUri = `${window.location.origin}/auth/callback`;

      const params = new URLSearchParams({
        client_id: config.client_id,
        redirect_uri: redirectUri,
        response_type: 'code',
        scope: 'openid profile email',
        // PKCE disabled for now (can be re-enabled if configured in Keycloak)
        // code_challenge_method: 'S256',
        // code_challenge: this.generateCodeChallenge(),
      });

      // Redirect to OpenID provider
      window.location.href = `${config.authorization_url}?${params.toString()}`;
    } catch (error) {
      console.error('Failed to get OpenID configuration:', error);
    }
  }

  private generateCodeChallenge(): string {
    // Generate a random code verifier and challenge for PKCE
    const verifier = this.generateRandomString(43);
    localStorage.setItem('pkce_verifier', verifier);

    // In production, this should be a SHA-256 hash of the verifier
    // For now, using plain verifier (implement proper SHA-256 for production)
    return verifier;
  }

  private generateRandomString(length: number): string {
    const charset = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~';
    const randomValues = new Uint8Array(length);
    crypto.getRandomValues(randomValues);
    return Array.from(randomValues)
      .map(v => charset[v % charset.length])
      .join('');
  }
}
