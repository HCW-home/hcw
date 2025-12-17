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

export interface IHealthMetricUser {
  id: number;
  email: string;
  first_name: string;
  last_name: string;
}

export interface IHealthMetricResponse {
  id: number;
  user: IHealthMetricUser;
  created_by: IHealthMetricUser | null;
  measured_by: IHealthMetricUser | null;
  measured_at: string;
  source: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
  height_cm: number | null;
  weight_kg: number | null;
  waist_cm: number | null;
  hip_cm: number | null;
  body_fat_pct: number | null;
  systolic_bp: number | null;
  diastolic_bp: number | null;
  heart_rate_bpm: number | null;
  respiratory_rate: number | null;
  temperature_c: number | null;
  spo2_pct: number | null;
  pain_score_0_10: number | null;
  glucose_fasting_mgdl: number | null;
  glucose_random_mgdl: number | null;
  hba1c_pct: number | null;
  chol_total_mgdl: number | null;
  hdl_mgdl: number | null;
  ldl_mgdl: number | null;
  triglycerides_mgdl: number | null;
  creatinine_mgdl: number | null;
  egfr_ml_min_1_73m2: number | null;
  bun_mgdl: number | null;
  alt_u_l: number | null;
  ast_u_l: number | null;
  alp_u_l: number | null;
  bilirubin_total_mgdl: number | null;
  sodium_mmol_l: number | null;
  potassium_mmol_l: number | null;
  chloride_mmol_l: number | null;
  bicarbonate_mmol_l: number | null;
  hemoglobin_g_dl: number | null;
  wbc_10e9_l: number | null;
  platelets_10e9_l: number | null;
  inr: number | null;
  crp_mg_l: number | null;
  esr_mm_h: number | null;
  tsh_miu_l: number | null;
  t3_ng_dl: number | null;
  t4_ug_dl: number | null;
  urine_protein: string | null;
  urine_glucose: string | null;
  urine_ketones: string | null;
  peak_flow_l_min: number | null;
  fev1_l: number | null;
  fvc_l: number | null;
  phq9_score: number | null;
  gad7_score: number | null;
  pregnant_test_positive: boolean | null;
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
