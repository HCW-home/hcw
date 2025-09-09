export interface IConsultation {
  id: string;
  patient_name: string;
  patient_avatar?: string;
  consultation_type: 'video' | 'audio' | 'chat';
  date: Date;
  duration: number;
  status: 'scheduled' | 'active' | 'completed' | 'cancelled';
  notes?: string;
  symptoms?: string[];
  prescription?: string;
  follow_up_required: boolean;
  patient_age?: number;
  patient_email?: string;
  patient_phone?: string;
}
