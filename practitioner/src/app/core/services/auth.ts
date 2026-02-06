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

  getOpenIDConfig(): Observable<IOpenIDConfig> {
    return this.http.get<IOpenIDConfig>(`${environment.apiUrl}/auth/openid/config/`);
  }

  /**
   * Login with OpenID Connect authorization code
   */
  loginWithOpenID(authorizationCode: string, pkceVerifier: string | null = null): Observable<IResponseLogin> {
    const body: any = {
      code: authorizationCode,
      callback_url: `${window.location.origin}/auth/callback`
    };

    if (pkceVerifier) {
      body.code_verifier = pkceVerifier;
    }

    return this.http.post<IResponseLogin>(`${environment.apiUrl}/auth/openid/`, body);
  }

  async initiateOpenIDLogin(): Promise<void> {
    try {
      const config = await firstValueFrom(this.getOpenIDConfig());

      if (!config.enabled || !config.client_id || !config.authorization_url) {
        console.error('OpenID Connect is not properly configured');
        return;
      }

      const params = new URLSearchParams({
        client_id: config.client_id,
        redirect_uri: `${window.location.origin}/auth/callback`,
        response_type: 'code',
        scope: 'openid profile email',
      });

      window.location.href = `${config.authorization_url}?${params.toString()}`;
    } catch (error) {
      console.error('Failed to get OpenID configuration:', error);
    }
  }

}
