export interface Consultation {
  id: number;
  title?: string;
  description?: string;
  beneficiary?: User;
  created_by: User;
  owned_by?: User;
  group?: Queue;
  created_at: string;
  modified_at: string;
  started_at?: string;
  finished_at?: string;
  closed_at?: string;
  status: 'REQUESTED' | 'ACTIVE' | 'CLOSED' | 'CANCELLED';
  reason?: Reason;
  notes?: string;
  prescriptions?: Prescription[];
  next_appointment?: Appointment;
  messages?: ConsultationMessage[];
}

export interface Queue {
  id: number;
  name: string;
}

export interface Speciality {
  id: number;
  name: string;
}

export interface Reason {
  id: number;
  name: string;
  description?: string;
  speciality?: Speciality | number;
  duration?: number;
  is_active?: boolean;
}

export interface Prescription {
  id: number;
  consultation: number;
  created_by: number;
  status: 'draft' | 'prescribed' | 'dispensed' | 'cancelled';
  medication_name: string;
  dosage: string;
  frequency: string;
  duration?: string;
  instructions?: string;
  notes?: string;
  created_at: string;
  updated_at?: string;
  prescribed_at?: string;
}

export type AppointmentStatus = 'draft' | 'scheduled' | 'cancelled';
export type AppointmentType = 'online' | 'inPerson';

export interface Appointment {
  id: number;
  consultation?: number;
  type: AppointmentType;
  status: AppointmentStatus;
  scheduled_at: string;
  end_expected_at?: string;
  started_at?: string;
  ended_at?: string;
  created_by: User;
  created_at: string;
  participants?: Participant[];
}

export interface Participant {
  id: number;
  appointment: number;
  user?: User;
  email?: string;
  phone?: string;
  timezone?: string;
  first_name?: string;
  last_name?: string;
  communication_method?: string | null;
  preferred_language?: string;
  is_invited: boolean;
  is_confirmed: boolean;
  is_active: boolean;
  feedback_rate?: number;
  feedback_message?: string;
  status?: string;
}

export interface MessageAttachment {
  file_name: string;
  mime_type: string;
}

export interface ConsultationMessage {
  id: number;
  consultation: number;
  created_by: User;
  created_at: string;
  updated_at?: string;
  is_edited?: boolean;
  deleted_at?: string | null;
  event?: string;
  content: string;
  attachment?: MessageAttachment | null;
}

export interface ConsultationRequest {
  id?: number;
  created_by?: User;
  beneficiary?: User | number;
  expected_with?: User | number;
  expected_at?: string;
  reason: Reason | number;
  type: 'online' | 'inPerson';
  comment?: string;
  status?: 'requested' | 'accepted' | 'cancelled' | 'refused';
  refused_reason?: string;
  appointment?: Appointment;
  consultation?: Consultation;
  created_at?: string;
}

export interface User {
  id: number;
  pk: number;
  username: string;
  email: string;
  first_name: string;
  last_name: string;
  picture?: string;
}

export interface Slot {
  date: string;
  start_time: string;
  end_time: string;
  duration: number;
  user_id: number;
  user_email: string;
  user_first_name: string;
  user_last_name: string;
}

export interface CreateRequestPayload {
  reason_id: number;
  expected_at: string;
  expected_with_id?: number;
  comment?: string;
}

export interface IDashboardResponse {
  requests: ConsultationRequest[];
  consultations: Consultation[];
  appointments: Appointment[];
}
