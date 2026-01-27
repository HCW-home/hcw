import { inject, Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { BehaviorSubject, Observable } from 'rxjs';
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
}
