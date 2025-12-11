export interface IPatient {
  id: number;
  name: string;
  avatar: string;
  email: string;
  phone: string;
  dateOfBirth: string;
  lastVisit: string;
  totalConsultations: number;
  status: 'active' | 'inactive';
}

export interface IHealthMetric {
  id: number;
  name: string;
  value: string;
  unit: string;
  icon: string;
  color: string;
  trend: 'up' | 'down' | 'stable';
  lastUpdated: string;
}

export interface IPatientAppointment {
  id: number;
  date: string;
  time: string;
  type: string;
  doctor: string;
  status: 'confirmed' | 'pending' | 'cancelled';
  notes: string;
}

export interface IPatientConsultation {
  id: number;
  date: string;
  time: string;
  type: string;
  doctor: string;
  duration: string;
  diagnosis: string;
  prescription: string;
  notes: string;
  status: 'completed' | 'cancelled';
}
