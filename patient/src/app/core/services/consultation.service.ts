import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { ApiService, PaginatedResponse } from './api.service';
import {
  Consultation,
  Appointment,
  Participant,
  ConsultationRequest,
  ConsultationMessage
} from '../models/consultation.model';

export interface ConsultationFilters {
  page?: number;
  limit?: number;
  status?: string;
}

export interface AppointmentFilters {
  page?: number;
  limit?: number;
  status?: string;
}

export interface CreateAppointmentRequest {
  consultation?: number;
  type: 'ONLINE' | 'IN_PERSON';
  scheduled_at: string;
  end_expected_at?: string;
  participants?: Partial<Participant>[];
}

export interface ConsultationRequestData {
  beneficiary_id?: number;
  expected_with_id?: number;
  expected_at?: string;
  reason_id: number | undefined;
  type: 'ONLINE' | 'IN_PERSON';
  comment?: string;
}

@Injectable({
  providedIn: 'root'
})
export class ConsultationService {
  constructor(private api: ApiService) {}

  getMyConsultations(filters?: ConsultationFilters): Observable<PaginatedResponse<Consultation>> {
    return this.api.get<PaginatedResponse<Consultation>>('/user/consultations/', filters);
  }

  getConsultationById(id: number): Observable<Consultation> {
    return this.api.get<Consultation>(`/user/consultations/${id}/`);
  }

  getMyAppointments(filters?: AppointmentFilters): Observable<PaginatedResponse<Appointment>> {
    return this.api.get<PaginatedResponse<Appointment>>('/user/appointments/', filters);
  }

  getAppointmentById(id: number): Observable<Appointment> {
    return this.api.get<Appointment>(`/appointments/${id}/`);
  }

  createAppointment(data: CreateAppointmentRequest): Observable<Appointment> {
    return this.api.post<Appointment>('/appointments/', data);
  }

  updateAppointment(id: number, data: Partial<Appointment>): Observable<Appointment> {
    return this.api.patch<Appointment>(`/appointments/${id}/`, data);
  }

  cancelAppointment(id: number): Observable<Appointment> {
    return this.api.patch<Appointment>(`/appointments/${id}/`, { status: 'CANCELLED' });
  }

  getConsultationMessages(consultationId: number): Observable<ConsultationMessage[]> {
    return this.api.get<PaginatedResponse<ConsultationMessage>>(`/user/consultations/${consultationId}/messages/`).pipe(
      map(response => response.results)
    );
  }

  getConsultationMessagesPaginated(consultationId: number, page: number = 1): Observable<PaginatedResponse<ConsultationMessage>> {
    return this.api.get<PaginatedResponse<ConsultationMessage>>(`/user/consultations/${consultationId}/messages/`, { page });
  }

  sendConsultationMessage(consultationId: number, content: string, attachment?: File): Observable<ConsultationMessage> {
    const formData = new FormData();
    formData.append('content', content);
    if (attachment) {
      formData.append('attachment', attachment);
    }
    return this.api.post<ConsultationMessage>(`/user/consultations/${consultationId}/messages/`, formData);
  }

  updateConsultationMessage(consultationId: number, messageId: number, content: string): Observable<ConsultationMessage> {
    return this.api.patch<ConsultationMessage>(`/messages/${messageId}/`, { content });
  }

  deleteConsultationMessage(messageId: number): Observable<ConsultationMessage> {
    return this.api.delete<ConsultationMessage>(`/messages/${messageId}/`);
  }

  getConsultationParticipants(consultationId: number): Observable<Participant[]> {
    return this.api.get<Participant[]>(`/consultations/${consultationId}/participants/`);
  }

  createConsultationRequest(data: ConsultationRequestData): Observable<ConsultationRequest> {
    return this.api.post<ConsultationRequest>('/requests/', data);
  }

  cancelConsultationRequest(id: number): Observable<void> {
    return this.api.post<void>(`/requests/${id}/cancel/`, {});
  }

  getMyRequests(): Observable<ConsultationRequest[]> {
    return this.api.get<ConsultationRequest[]>('/requests/');
  }

  getRequestById(id: number): Observable<ConsultationRequest> {
    return this.api.get<ConsultationRequest>(`/requests/${id}/`);
  }

  closeConsultation(id: number): Observable<Consultation> {
    return this.api.post<Consultation>(`/consultations/${id}/close/`, {});
  }

  reopenConsultation(id: number): Observable<Consultation> {
    return this.api.post<Consultation>(`/consultations/${id}/reopen/`, {});
  }

  joinConsultation(consultationId: number): Observable<{
    url: string;
    token: string;
    room: string;
  }> {
    return this.api.get<{ url: string; token: string; room: string }>(
      `/consultations/${consultationId}/join/`
    );
  }

  joinAppointment(appointmentId: number): Observable<{
    url: string;
    token: string;
    room: string;
  }> {
    return this.api.get<{ url: string; token: string; room: string }>(
      `/user/appointments/${appointmentId}/join/`
    );
  }

  confirmAppointmentPresence(appointmentId: number, isPresent: boolean): Observable<{
    detail: string;
    is_confirmed: boolean;
  }> {
    return this.api.post<{ detail: string; is_confirmed: boolean }>(
      `/user/appointments/${appointmentId}/presence/`,
      { is_present: isPresent }
    );
  }

  getMessageAttachment(messageId: number): Observable<Blob> {
    return this.api.getBlob(`/messages/${messageId}/attachment/`);
  }
}
