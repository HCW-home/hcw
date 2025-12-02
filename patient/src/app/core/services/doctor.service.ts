import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { ApiService, PaginatedResponse } from './api.service';
import { Doctor, Speciality } from '../models/doctor.model';
import { BookingSlot, TimeSlot } from '../models/booking.model';

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

  getAvailableSlots(reasonId: number): Observable<TimeSlot[]> {
    return this.api.get<TimeSlot[]>(`/reasons/${reasonId}/slots/`);
  }

  getDoctorBookingSlots(doctorId: number): Observable<BookingSlot[]> {
    return this.api.get<BookingSlot[]>('/user/bookingslots/', { user: doctorId });
  }
}
