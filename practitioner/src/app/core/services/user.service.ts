import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';
import {
  User,
  Speciality,
  HealthMetric,
  UpdateUserRequest,
} from '../models/user';
import { Consultation } from '../models/consultation';
import { PaginatedResponse } from '../models/global';
import { toHttpParams } from '../../shared/tools/helper';

@Injectable({
  providedIn: 'root'
})
export class UserService {
  private httpClient = inject(HttpClient);
  private readonly apiUrl = environment.apiUrl;

  getCurrentUser(): Observable<User> {
    return this.httpClient.get<User>(`${this.apiUrl}/auth/user/`);
  }

  updateProfile(userData: UpdateUserRequest): Observable<User> {
    return this.httpClient.patch<User>(`${this.apiUrl}/auth/user/`, userData);
  }

  getUserConsultations(params?: {
    status?: 'open' | 'closed';
    page?: number;
    page_size?: number;
  }): Observable<PaginatedResponse<Consultation>> {
    const httpParams = toHttpParams(params || {});

    return this.httpClient.get<PaginatedResponse<Consultation>>(
      `${this.apiUrl}/user/consultations/`,
      { params: httpParams }
    );
  }

  getUserHealthMetrics(params?: {
    from_date?: string;
    to_date?: string;
    source?: string;
    page?: number;
    page_size?: number;
  }): Observable<PaginatedResponse<HealthMetric>> {
    const httpParams = toHttpParams(params || {});

    return this.httpClient.get<PaginatedResponse<HealthMetric>>(
      `${this.apiUrl}/user/healthmetrics/`,
      { params: httpParams }
    );
  }

  getSpecialities(): Observable<Speciality[]> {
    return this.httpClient.get<Speciality[]>(`${this.apiUrl}/specialities/`);
  }
}
