export interface User {
  id: number;
  email: string;
  first_name: string;
  last_name: string;
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
  is_invited: boolean;
  is_confirmed: boolean;
  email: string | null;
  phone: string | null;
  message_type?: string;
  feedback_rate: number | null;
  feedback_message: string | null;
}

export enum AppointmentStatus {
  SCHEDULED = 'Scheduled',
  CANCELLED = 'Cancelled'
}

export enum AppointmentType {
  ONLINE = 'Online',
  INPERSON = 'InPerson'
}

export interface Appointment {
  id: number;
  type: AppointmentType;
  scheduled_at: string;
  end_expected_at: string | null;
  consultation: number;
  created_by: number;
  status: AppointmentStatus;
  created_at: string;
  participants: Participant[];
}

export interface ConsultationMessage {
  id: number;
  content: string | null;
  attachment: string | null;
  created_at: string;
  created_by: number;
  consultation: number;
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
  title?: string;
  description?: string;
  group_id?: number;
  beneficiary?: number;
}

export interface Reason {
  id: number;
  name: string;
  duration: number;
  queue_assignee: number | null;
  user_assignee: number | null;
}

export enum RequestStatus {
  REQUESTED = 'Requested',
  ACCEPTED = 'Accepted',
  CANCELLED = 'Cancelled'
}

export enum RequestType {
  ONLINE = 'Online',
  INPERSON = 'InPerson'
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
  scheduled_at: string;
  end_expected_at?: string;
}

export interface CreateParticipantRequest {
  user_id?: number;
  email?: string;
  phone?: string;
  message_type: string;
}
