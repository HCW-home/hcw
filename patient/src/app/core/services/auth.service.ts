import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { BehaviorSubject, Observable, from, switchMap, tap } from 'rxjs';
import { environment } from '../../../environments/environment';
import { User, LoginRequest, LoginResponse, RegisterRequest, MagicLinkRequest, MagicLinkVerify } from '../models/user.model';
import { StorageService } from './storage.service';

@Injectable({
  providedIn: 'root'
})
export class AuthService {
  private apiUrl = environment.apiUrl;
  private currentUserSubject = new BehaviorSubject<User | null>(null);
  public currentUser$ = this.currentUserSubject.asObservable();
  private isAuthenticatedSubject = new BehaviorSubject<boolean>(false);
  public isAuthenticated$ = this.isAuthenticatedSubject.asObservable();

  constructor(
    private http: HttpClient,
    private storage: StorageService
  ) {
    this.checkAuthStatus();
  }

  async checkAuthStatus() {
    const token = await this.storage.get('access_token');
    console.log('checkAuthStatus - token:', token ? 'exists' : 'missing');
    if (token) {
      this.isAuthenticatedSubject.next(true);
      this.getCurrentUser().subscribe();
    }
  }

  login(credentials: LoginRequest): Observable<LoginResponse> {
    return this.http.post<LoginResponse>(`${this.apiUrl}/auth/login/`, credentials)
      .pipe(
        switchMap(async (response) => {
          if (response.access) {
            await this.storage.set('access_token', response.access);
            await this.storage.set('refresh_token', response.refresh);
            this.isAuthenticatedSubject.next(true);
            if (response.user) {
              this.currentUserSubject.next(response.user);
            }
          }
          return response;
        })
      );
  }

  register(data: RegisterRequest): Observable<any> {
    return this.http.post(`${this.apiUrl}/auth/registration/`, data);
  }

  requestMagicLink(data: MagicLinkRequest): Observable<any> {
    return this.http.post(`${this.apiUrl}/auth/magic-link/request/`, data);
  }

  verifyMagicLink(data: MagicLinkVerify): Observable<LoginResponse> {
    return this.http.post<LoginResponse>(`${this.apiUrl}/auth/magic-link/verify/`, data)
      .pipe(
        switchMap(async (response) => {
          if (response.access) {
            await this.storage.set('access_token', response.access);
            await this.storage.set('refresh_token', response.refresh);
            this.isAuthenticatedSubject.next(true);
            if (response.user) {
              this.currentUserSubject.next(response.user);
            }
          }
          return response;
        })
      );
  }

  getCurrentUser(): Observable<User> {
    return this.http.get<User>(`${this.apiUrl}/auth/user/`)
      .pipe(
        tap(user => this.currentUserSubject.next(user))
      );
  }

  async logout() {
    await this.storage.remove('access_token');
    await this.storage.remove('refresh_token');
    this.currentUserSubject.next(null);
    this.isAuthenticatedSubject.next(false);
  }

  async getToken(): Promise<string | null> {
    return await this.storage.get('access_token');
  }

  isLoggedIn(): boolean {
    return this.isAuthenticatedSubject.value;
  }

  async refreshToken(): Promise<Observable<any>> {
    const refresh = await this.storage.get('refresh_token');
    return this.http.post(`${this.apiUrl}/auth/token/refresh/`, { refresh })
      .pipe(
        tap(async (response: any) => {
          if (response.access) {
            await this.storage.set('access_token', response.access);
          }
        })
      );
  }
}