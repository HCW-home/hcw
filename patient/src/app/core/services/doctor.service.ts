import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { ApiService, PaginatedResponse } from './api.service';
import { Doctor } from '../models/doctor.model';
import { Slot } from '../models/consultation.model';

export interface DoctorFilters {
  page?: number;
  limit?: number;
  speciality?: number;
  search?: string;
  is_online?: boolean;
  organisation?: number;
}

@Injectable({
  providedIn: 'root'
})
export class DoctorService {
  constructor(private api: ApiService) {}

  getDoctors(filters?: DoctorFilters): Observable<PaginatedResponse<Doctor>> {
    return this.api.get<PaginatedResponse<Doctor>>('/users/', filters);
  }

  getDoctorById(id: number): Observable<Doctor> {
    return this.api.get<Doctor>(`/users/${id}/`);
  }

  getDoctorsBySpeciality(specialityId: number): Observable<Doctor[]> {
    return this.api.get<Doctor[]>(`/specialities/${specialityId}/doctors/`);
  }

  getAvailableSlots(reasonId: number, params?: { from_date?: string; user_id?: number; organisation_id?: number }): Observable<Slot[]> {
    return this.api.get<Slot[]>(`/reasons/${reasonId}/slots/`, params);
  }

}
