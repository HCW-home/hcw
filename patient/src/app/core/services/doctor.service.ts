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

export interface Reason {
  id: number;
  name: string;
  duration: number;
  assignment_method: string;
  skip_doctor_selection: boolean;
  custom_fields: {
    id: number;
    name: string;
    field_type: string;
    target_model: string;
    required: boolean;
    options: string;
    ordering: number;
  }[];
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

  getReasonsBySpeciality(specialityId: number): Observable<Reason[]> {
    return this.api.get<Reason[]>(`/specialities/${specialityId}/reasons/`);
  }

  getAvailableSlots(reasonId: number, params?: { from_date?: string; user_id?: number; organisation_id?: number }): Observable<Slot[]> {
    return this.api.get<Slot[]>(`/reasons/${reasonId}/slots/`, params);
  }
}