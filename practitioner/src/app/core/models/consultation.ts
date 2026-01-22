export interface User {
  id: number;
  email: string;
  first_name: string;
  last_name: string;
  is_online?: boolean;
}

export interface Queue {
  id: number;
  name: string;
  users: User[];
}

export interface Participant {
  id: number;
  appointment?: number;
  user: User | null;
  auth_token?: string;
  email: string | null;
  phone: string | null;
  timezone?: string;
  first_name: string | null;
  last_name: string | null;
  message_type?: string;
  communication_method?: string;
  preferred_language?: string;
  feedback_rate: number | null;
  feedback_message: string | null;
  status: ParticipantStatus;
}

export type ParticipantStatus = 'draft' | 'invited' | 'confirmed' | 'not available';

export enum AppointmentStatus {
  DRAFT = 'draft',
  SCHEDULED = 'scheduled',
  CANCELLED = 'cancelled'
}

export enum AppointmentType {
  ONLINE = 'online',
  INPERSON = 'inPerson'
}

export interface Appointment {
  id: number;
  type: AppointmentType;
  scheduled_at: string;
  end_expected_at: string | null;
  consultation: number;
  created_by: User;
  status: AppointmentStatus;
  created_at: string;
  participants: Participant[];
}

export interface MessageAttachment {
  file_name: string;
  mime_type: string;
}

export interface ConsultationMessage {
  id: number;
  content: string | null;
  attachment: MessageAttachment | null;
  created_at: string;
  updated_at: string;
  is_edited: boolean;
  deleted_at?: string | null;
  created_by: User;
}

export interface Consultation {
  id: number;
  created_at: string;
  updated_at: string;
  closed_at: string | null;
  title: string | null;
  description: string | null;
  beneficiary: User | null;
  beneficiary_id?: number;
  created_by: User;
  owned_by: User;
  group: Queue | null;
  group_id?: number;
}

export interface CreateConsultationRequest {
  title?: string | null;
  description?: string | null;
  group_id?: number | null;
  beneficiary_id?: number | null;
  owned_by_id?: number | null;
}

export interface Reason {
  id: number;
  name: string;
  duration: number;
  queue_assignee: number | null;
  user_assignee: number | null;
}

export enum RequestStatus {
  REQUESTED = 'requested',
  ACCEPTED = 'accepted',
  CANCELLED = 'cancelled',
  REFUSED = 'refused'
}

export enum RequestType {
  ONLINE = 'online',
  INPERSON = 'inPerson'
}

export interface ConsultationRequest {
  id: number;
  expected_at: string;
  expected_with: User | null;
  expected_with_id?: number;
  reason: Reason;
  reason_id?: number;
  created_by: User;
  comment: string;
  status: RequestStatus;
  type: RequestType;
}

export interface CreateConsultationRequestPayload {
  expected_at: string;
  expected_with_id?: number;
  reason_id: number;
  comment: string;
  type?: RequestType;
}

export interface BookingSlot {
  id: number;
  user: User;
  start_time: string;
  end_time: string;
  start_break: string | null;
  end_break: string | null;
  monday: boolean;
  tuesday: boolean;
  wednesday: boolean;
  thursday: boolean;
  friday: boolean;
  saturday: boolean;
  sunday: boolean;
  valid_until: string | null;
}

export interface CreateBookingSlot {
  start_time: string;
  end_time: string;
  start_break?: string | null;
  end_break?: string | null;
  monday: boolean;
  tuesday: boolean;
  wednesday: boolean;
  thursday: boolean;
  friday: boolean;
  saturday: boolean;
  sunday: boolean;
  valid_until?: string | null;
}

export interface AvailableSlot {
  date: string;
  start_time: string;
  end_time: string;
  duration: number;
  user_id: number;
  user_email: string;
  user_first_name: string;
  user_last_name: string;
}

export interface CreateAppointmentRequest {
  type?: AppointmentType;
  status?: AppointmentStatus;
  scheduled_at?: string;
  end_expected_at?: string;
  participants?: CreateParticipantRequest[];
  dont_invite_beneficiary?: boolean;
  dont_invite_practitioner?: boolean;
  dont_invite_me?: boolean;
}

export interface CreateParticipantRequest {
  user_id?: number;
  email?: string;
  phone?: string;
  first_name?: string;
  last_name?: string;
  message_type: string;
  timezone?: string;
  communication_method?: string;
  preferred_language?: string;
}

export interface DashboardNextAppointment {
  scheduled_at: string | null;
  end_expected_at: string | null;
  type: string | null;
  consultation_id: number | null;
  status: string | null;
  participants: Participant[];
  dont_invite_beneficiary: boolean;
  dont_invite_practitioner: boolean;
  dont_invite_me: boolean;
}

export interface DashboardResponse {
  next_appointment: DashboardNextAppointment | null;
  upcoming_appointments: Appointment[];
  overdue_consultations: Consultation[];
}
