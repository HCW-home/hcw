
import { Injectable } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Observable, BehaviorSubject, tap } from 'rxjs';
import { environment } from '../../../environments/environment';

export interface User {
  id: number;
  email: string;
  first_name: string;
  last_name: string;
  languages: any[];
  specialites: any[];
}

export interface LoginRequest {
  email: string;
  password: string;
}

export interface LoginResponse {
  access: string;
  refresh: string;
  user: User;
}

export interface Group {
  id: number;
  name: string;
  users: User[];
}


export interface Message {
  id: number;
  content: string;
  subject: string;
  message_type: 'sms' | 'email' | 'whatsapp' | 'push';
  provider_name: string;
  recipient_phone: string;
  recipient_email: string;
  status: 'pending' | 'sent' | 'delivered' | 'failed' | 'read';
  sent_at: string | null;
  delivered_at: string | null;
  read_at: string | null;
  failed_at: string | null;
  sent_by: User;
  participant: any | null;
  celery_task_id: string;
  created_at: string;
  updated_at: string;
}

@Injectable({
  providedIn: 'root'
})
export class AuthService {
  private readonly API_URL = environment.apiUrl;
  private readonly TOKEN_KEY = 'access_token';
  private readonly REFRESH_TOKEN_KEY = 'refresh_token';

  private currentUserSubject = new BehaviorSubject<User | null>(null);
  public currentUser$ = this.currentUserSubject.asObservable();

  constructor(private http: HttpClient) {
    // Check if user is already logged in
    this.initializeAuth();
  }

  private initializeAuth(): void {
    const token = this.getToken();
    if (token) {
      // TODO: Validate token and get user info
      this.getUserProfile().subscribe({
        next: (user) => this.currentUserSubject.next(user),
        error: () => this.logout()
      });
    }
  }

  // Authentication Methods
  login(credentials: LoginRequest): Observable<LoginResponse> {
    return this.http.post<LoginResponse>(`${this.API_URL}/auth/login/`, credentials)
      .pipe(
        tap(response => {
          this.setToken(response.access);
          this.setRefreshToken(response.refresh);
          this.currentUserSubject.next(response.user);
        })
      );
  }

  logout(): Observable<any> {
    return this.http.post(`${this.API_URL}/auth/logout/`, {})
      .pipe(
        tap(() => {
          this.clearTokens();
          this.currentUserSubject.next(null);
        })
      );
  }

  register(userData: any): Observable<any> {
    return this.http.post(`${this.API_URL}/auth/registration/`, userData);
  }

  // Token Management
  getToken(): string | null {
    return localStorage.getItem(this.TOKEN_KEY);
  }

  private setToken(token: string): void {
    localStorage.setItem(this.TOKEN_KEY, token);
  }

  private getRefreshToken(): string | null {
    return localStorage.getItem(this.REFRESH_TOKEN_KEY);
  }

  private setRefreshToken(token: string): void {
    localStorage.setItem(this.REFRESH_TOKEN_KEY, token);
  }

  private clearTokens(): void {
    localStorage.removeItem(this.TOKEN_KEY);
    localStorage.removeItem(this.REFRESH_TOKEN_KEY);
  }

  isAuthenticated(): boolean {
    return !!this.getToken();
  }

  // HTTP Headers with Auth Token
  private getAuthHeaders(): HttpHeaders {
    const token = this.getToken();
    return new HttpHeaders({
      'Authorization': token ? `Bearer ${token}` : ''
    });
  }

  // User Profile
  getUserProfile(): Observable<User> {
    return this.http.get<User>(`${this.API_URL}/auth/user/`, {
      headers: this.getAuthHeaders()
    });
  }


  // User Groups API
  getGroups(): Observable<Group[]> {
    return this.http.get<Group[]>(`${this.API_URL}/groups/`, {
      headers: this.getAuthHeaders()
    });
  }

  getGroup(id: number): Observable<Group> {
    return this.http.get<Group>(`${this.API_URL}/groups/${id}/`, {
      headers: this.getAuthHeaders()
    });
  }

  // Messages API
  getMessages(): Observable<Message[]> {
    return this.http.get<Message[]>(`${this.API_URL}/messages/`, {
      headers: this.getAuthHeaders()
    });
  }

  getMessage(id: number): Observable<Message> {
    return this.http.get<Message>(`${this.API_URL}/messages/${id}/`, {
      headers: this.getAuthHeaders()
    });
  }

  createMessage(messageData: any): Observable<Message> {
    return this.http.post<Message>(`${this.API_URL}/messages/`, messageData, {
      headers: this.getAuthHeaders()
    });
  }

  resendMessage(id: number): Observable<Message> {
    return this.http.post<Message>(`${this.API_URL}/messages/${id}/resend/`, {}, {
      headers: this.getAuthHeaders()
    });
  }

  markMessageDelivered(id: number): Observable<Message> {
    return this.http.post<Message>(`${this.API_URL}/messages/${id}/mark_delivered/`, {}, {
      headers: this.getAuthHeaders()
    });
  }

  markMessageRead(id: number): Observable<Message> {
    return this.http.post<Message>(`${this.API_URL}/messages/${id}/mark_read/`, {}, {
      headers: this.getAuthHeaders()
    });
  }

  // Appointments API
  getAppointments(): Observable<any[]> {
    return this.http.get<any[]>(`${this.API_URL}/appointments/`, {
      headers: this.getAuthHeaders()
    });
  }

  getAppointment(id: number): Observable<any> {
    return this.http.get<any>(`${this.API_URL}/appointments/${id}/`, {
      headers: this.getAuthHeaders()
    });
  }

  createAppointment(appointmentData: any): Observable<any> {
    return this.http.post<any>(`${this.API_URL}/appointments/`, appointmentData, {
      headers: this.getAuthHeaders()
    });
  }

  updateAppointment(id: number, appointmentData: any): Observable<any> {
    return this.http.put<any>(`${this.API_URL}/appointments/${id}/`, appointmentData, {
      headers: this.getAuthHeaders()
    });
  }

  deleteAppointment(id: number): Observable<any> {
    return this.http.delete(`${this.API_URL}/appointments/${id}/`, {
      headers: this.getAuthHeaders()
    });
  }

  // Participants API
  getParticipants(): Observable<any[]> {
    return this.http.get<any[]>(`${this.API_URL}/participants/`, {
      headers: this.getAuthHeaders()
    });
  }

  getParticipant(id: number): Observable<any> {
    return this.http.get<any>(`${this.API_URL}/participants/${id}/`, {
      headers: this.getAuthHeaders()
    });
  }

  createParticipant(participantData: any): Observable<any> {
    return this.http.post<any>(`${this.API_URL}/participants/`, participantData, {
      headers: this.getAuthHeaders()
    });
  }

  updateParticipant(id: number, participantData: any): Observable<any> {
    return this.http.put<any>(`${this.API_URL}/participants/${id}/`, participantData, {
      headers: this.getAuthHeaders()
    });
  }

  deleteParticipant(id: number): Observable<any> {
    return this.http.delete(`${this.API_URL}/participants/${id}/`, {
      headers: this.getAuthHeaders()
    });
  }
}
