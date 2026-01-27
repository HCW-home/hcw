import { inject, Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';
import {
  Queue,
  Participant,
  BookingSlot,
  Appointment,
  Consultation,
  AvailableSlot,
  CreateBookingSlot,
  ConsultationMessage,
  ConsultationRequest,
  CreateAppointmentRequest,
  UpdateAppointmentRequest,
  CreateParticipantRequest,
  CreateConsultationRequest,
  CreateConsultationRequestPayload,
  DashboardResponse,
} from '../models/consultation';
import { PaginatedResponse } from '../models/global';

@Injectable({
  providedIn: 'root',
})
export class ConsultationService {
  private apiUrl = `${environment.apiUrl}`;
  http: HttpClient = inject(HttpClient);

  getConsultations(params?: {
    page?: number;
    page_size?: number;
    group?: number;
    beneficiary?: number;
    created_by?: number;
    owned_by?: number;
    is_closed?: boolean;
    closed_at?: string;
  }): Observable<PaginatedResponse<Consultation>> {
    let httpParams = new HttpParams();
    if (params) {
      Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined && value !== null) {
          httpParams = httpParams.set(key, value.toString());
        }
      });
    }
    return this.http.get<PaginatedResponse<Consultation>>(
      `${this.apiUrl}/consultations/`,
      { params: httpParams }
    );
  }

  getConsultation(id: number): Observable<Consultation> {
    return this.http.get<Consultation>(`${this.apiUrl}/consultations/${id}/`);
  }

  createConsultation(
    data: CreateConsultationRequest
  ): Observable<Consultation> {
    return this.http.post<Consultation>(`${this.apiUrl}/consultations/`, data);
  }

  updateConsultation(
    id: number,
    data: Partial<CreateConsultationRequest>
  ): Observable<Consultation> {
    return this.http.patch<Consultation>(
      `${this.apiUrl}/consultations/${id}/`,
      data
    );
  }

  deleteConsultation(id: number): Observable<void> {
    return this.http.delete<void>(`${this.apiUrl}/consultations/${id}/`);
  }

  closeConsultation(id: number): Observable<Consultation> {
    return this.http.post<Consultation>(
      `${this.apiUrl}/consultations/${id}/close/`,
      {}
    );
  }

  reopenConsultation(id: number): Observable<Consultation> {
    return this.http.post<Consultation>(
      `${this.apiUrl}/consultations/${id}/reopen/`,
      {}
    );
  }

  getOverdueConsultations(params?: {
    page?: number;
    page_size?: number;
  }): Observable<PaginatedResponse<Consultation>> {
    let httpParams = new HttpParams();
    if (params) {
      Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined && value !== null) {
          httpParams = httpParams.set(key, value.toString());
        }
      });
    }
    return this.http.get<PaginatedResponse<Consultation>>(
      `${this.apiUrl}/consultations/overdue/`,
      { params: httpParams }
    );
  }

  getConsultationAppointments(
    consultationId: number,
    params?: {
      page?: number;
      page_size?: number;
      status?: string;
    }
  ): Observable<PaginatedResponse<Appointment>> {
    let httpParams = new HttpParams();
    if (params) {
      Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined && value !== null) {
          httpParams = httpParams.set(key, value.toString());
        }
      });
    }
    httpParams = httpParams.set('consultation', consultationId.toString());
    return this.http.get<PaginatedResponse<Appointment>>(
      `${this.apiUrl}/appointments/`,
      { params: httpParams }
    );
  }

  createConsultationAppointment(
    consultationId: number,
    data: CreateAppointmentRequest
  ): Observable<Appointment> {
    return this.http.post<Appointment>(
      `${this.apiUrl}/appointments/`,
      { ...data, consultation_id: consultationId }
    );
  }

  getAppointments(params?: {
    page?: number;
    page_size?: number;
    consultation__beneficiary?: number;
    consultation__created_by?: number;
    consultation__owned_by?: number;
    status?: string;
  }): Observable<PaginatedResponse<Appointment>> {
    let httpParams = new HttpParams();
    if (params) {
      Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined && value !== null) {
          httpParams = httpParams.set(key, value.toString());
        }
      });
    }
    return this.http.get<PaginatedResponse<Appointment>>(
      `${this.apiUrl}/appointments/`,
      { params: httpParams }
    );
  }

  getAppointment(appointmentId: number): Observable<Appointment> {
    return this.http.get<Appointment>(
      `${this.apiUrl}/appointments/${appointmentId}/`
    );
  }

  updateAppointment(
    appointmentId: number,
    data: UpdateAppointmentRequest
  ): Observable<Appointment> {
    return this.http.patch<Appointment>(
      `${this.apiUrl}/appointments/${appointmentId}/`,
      data
    );
  }

  deleteAppointment(appointmentId: number): Observable<void> {
    return this.http.delete<void>(
      `${this.apiUrl}/appointments/${appointmentId}/`
    );
  }

  cancelAppointment(appointmentId: number): Observable<Appointment> {
    return this.http.post<Appointment>(
      `${this.apiUrl}/appointments/${appointmentId}/cancel/`,
      {}
    );
  }

  sendAppointment(appointmentId: number): Observable<Appointment> {
    return this.http.post<Appointment>(
      `${this.apiUrl}/appointments/${appointmentId}/send/`,
      {}
    );
  }

  getConsultationMessages(
    consultationId: number,
    params?: { page?: number; page_size?: number }
  ): Observable<PaginatedResponse<ConsultationMessage>> {
    let httpParams = new HttpParams();
    if (params) {
      Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined && value !== null) {
          httpParams = httpParams.set(key, value.toString());
        }
      });
    }
    return this.http.get<PaginatedResponse<ConsultationMessage>>(
      `${this.apiUrl}/consultations/${consultationId}/messages/`,
      { params: httpParams }
    );
  }

  sendConsultationMessage(
    consultationId: number,
    data: { content?: string; attachment?: File }
  ): Observable<ConsultationMessage> {
    const formData = new FormData();
    if (data.content) {
      formData.append('content', data.content);
    }
    if (data.attachment) {
      formData.append('attachment', data.attachment);
    }

    return this.http.post<ConsultationMessage>(
      `${this.apiUrl}/consultations/${consultationId}/messages/`,
      formData
    );
  }

  updateConsultationMessage(
    messageId: number,
    content: string
  ): Observable<ConsultationMessage> {
    return this.http.patch<ConsultationMessage>(
      `${this.apiUrl}/messages/${messageId}/`,
      { content }
    );
  }

  deleteConsultationMessage(messageId: number): Observable<ConsultationMessage> {
    return this.http.delete<ConsultationMessage>(
      `${this.apiUrl}/messages/${messageId}/`
    );
  }

  getQueues(): Observable<Queue[]> {
    return this.http.get<Queue[]>(`${this.apiUrl}/queues/`);
  }

  getQueue(id: number): Observable<Queue> {
    return this.http.get<Queue>(`${this.apiUrl}/queues/${id}/`);
  }

  getConsultationRequests(params?: {
    page?: number;
    page_size?: number;
  }): Observable<PaginatedResponse<ConsultationRequest>> {
    let httpParams = new HttpParams();
    if (params) {
      Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined && value !== null) {
          httpParams = httpParams.set(key, value.toString());
        }
      });
    }
    return this.http.get<PaginatedResponse<ConsultationRequest>>(
      `${this.apiUrl}/requests/`,
      { params: httpParams }
    );
  }

  getConsultationRequest(id: number): Observable<ConsultationRequest> {
    return this.http.get<ConsultationRequest>(`${this.apiUrl}/requests/${id}/`);
  }

  createConsultationRequest(
    data: CreateConsultationRequestPayload
  ): Observable<ConsultationRequest> {
    return this.http.post<ConsultationRequest>(
      `${this.apiUrl}/requests/`,
      data
    );
  }

  cancelConsultationRequest(id: number): Observable<ConsultationRequest> {
    return this.http.post<ConsultationRequest>(
      `${this.apiUrl}/requests/${id}/cancel/`,
      {}
    );
  }

  getAvailableSlots(
    reasonId: number,
    params?: {
      from_date?: string;
      user_id?: number;
    }
  ): Observable<AvailableSlot[]> {
    let httpParams = new HttpParams();
    if (params) {
      Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined && value !== null) {
          httpParams = httpParams.set(key, value.toString());
        }
      });
    }
    return this.http.get<AvailableSlot[]>(
      `${this.apiUrl}/reasons/${reasonId}/slots/`,
      { params: httpParams }
    );
  }

  getBookingSlots(params?: {
    page?: number;
    page_size?: number;
    user?: number;
    monday?: boolean;
    tuesday?: boolean;
    wednesday?: boolean;
    thursday?: boolean;
    friday?: boolean;
    saturday?: boolean;
    sunday?: boolean;
    valid_until?: string;
  }): Observable<PaginatedResponse<BookingSlot>> {
    let httpParams = new HttpParams();
    if (params) {
      Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined && value !== null) {
          httpParams = httpParams.set(key, value.toString());
        }
      });
    }
    return this.http.get<PaginatedResponse<BookingSlot>>(
      `${this.apiUrl}/user/bookingslots/`,
      { params: httpParams }
    );
  }

  getBookingSlot(id: number): Observable<BookingSlot> {
    return this.http.get<BookingSlot>(
      `${this.apiUrl}/user/bookingslots/${id}/`
    );
  }

  createBookingSlot(data: CreateBookingSlot): Observable<BookingSlot> {
    return this.http.post<BookingSlot>(
      `${this.apiUrl}/user/bookingslots/`,
      data
    );
  }

  updateBookingSlot(
    id: number,
    data: Partial<CreateBookingSlot>
  ): Observable<BookingSlot> {
    return this.http.patch<BookingSlot>(
      `${this.apiUrl}/user/bookingslots/${id}/`,
      data
    );
  }

  deleteBookingSlot(id: number): Observable<void> {
    return this.http.delete<void>(`${this.apiUrl}/user/bookingslots/${id}/`);
  }

  getLivekitToken(consultationId: number): Observable<{
    url: string;
    room: string;
    token: string;
  }> {
    return this.http.get<{ url: string; room: string; token: string }>(
      `${this.apiUrl}/consultations/${consultationId}/livekit_token/`
    );
  }

  joinConsultation(consultationId: number): Observable<{
    url: string;
    token: string;
    room: string;
  }> {
    return this.http.get<{ url: string; token: string; room: string }>(
      `${this.apiUrl}/consultations/${consultationId}/join/`
    );
  }

  joinAppointment(appointmentId: number): Observable<{
    url: string;
    token: string;
    room: string;
  }> {
    return this.http.get<{ url: string; token: string; room: string }>(
      `${this.apiUrl}/appointments/${appointmentId}/join/`
    );
  }

  getMessageAttachment(messageId: number): Observable<Blob> {
    return this.http.get(`${this.apiUrl}/messages/${messageId}/attachment/`, {
      responseType: 'blob'
    });
  }

  getDashboard(): Observable<DashboardResponse> {
    return this.http.get<DashboardResponse>(`${this.apiUrl}/dashboard/`);
  }

  confirmAppointmentPresence(appointmentId: number, isPresent: boolean): Observable<Appointment> {
    return this.http.post<Appointment>(
      `${this.apiUrl}/user/appointments/${appointmentId}/presence/`,
      { is_present: isPresent }
    );
  }
}
