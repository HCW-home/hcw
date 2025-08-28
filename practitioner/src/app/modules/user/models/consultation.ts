export interface IConsultation {
  id: string;
  patient_name: string;
  patient_avatar?: string;
  consultation_type: 'video' | 'audio' | 'chat';
  date: Date;
  duration: number; // in minutes
  status: 'scheduled' | 'active' | 'completed' | 'cancelled';
  notes?: string;
  symptoms?: string[];
  prescription?: string;
  follow_up_required: boolean;
  patient_age?: number;
  patient_email?: string;
  patient_phone?: string;
}

export interface IAppointment {
  id: string;
  consultation_id: string;
  start_time: Date;
  end_time: Date;
  status: 'scheduled' | 'completed' | 'cancelled' | 'no_show';
  reminder_sent: boolean;
}

export interface IAvailabilitySlot {
  id?: string;
  day_of_week: number; // 0-6 (Sunday = 0)
  start_time: string; // HH:mm format
  end_time: string; // HH:mm format
  is_available: boolean;
  recurring: boolean;
  date?: Date; // for specific date slots
}