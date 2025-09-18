export interface Consultation {
  id: number;
  beneficiary?: User;
  created_by: User;
  owned_by?: User;
  group?: any;
  created_at: string;
  modified_at: string;
  started_at?: string;
  finished_at?: string;
  status: 'REQUESTED' | 'ACTIVE' | 'CLOSED' | 'CANCELLED';
  reason?: Reason;
  notes?: string;
  prescriptions?: Prescription[];
}

export interface Reason {
  id: number;
  name: string;
  description?: string;
  speciality?: number;
}

export interface Prescription {
  id: number;
  consultation: number;
  created_by: number;
  status: 'DRAFT' | 'ISSUED' | 'DISPENSED';
  medication_name: string;
  dosage: string;
  frequency: string;
  duration?: string;
  instructions?: string;
  created_at: string;
}

export interface Appointment {
  id: number;
  title: string;
  description?: string;
  start_time: string;
  end_time: string;
  location?: string;
  status: 'SCHEDULED' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED';
  participants?: Participant[];
  meeting_url?: string;
  created_by: User;
}

export interface Participant {
  id: number;
  appointment: number;
  user?: User;
  email?: string;
  phone?: string;
  display_name?: string;
  is_invited: boolean;
  is_confirmed: boolean;
  feedback_rate?: number;
  feedback_message?: string;
}

export interface ConsultationRequest {
  beneficiary?: number;
  expected_with?: number;
  reason: number;
  type: 'ONLINE' | 'IN_PERSON';
  notes?: string;
  preferred_date?: string;
  preferred_time?: string;
}

export interface User {
  id: number;
  username: string;
  email: string;
  first_name: string;
  last_name: string;
  picture?: string;
}