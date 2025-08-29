export interface User {
  id: number;
  email: string;
  first_name: string;
  last_name: string;
  app_preferences?: any;
  last_login?: string;
  communication_method: 'email' | 'sms' | 'whatsapp';
  mobile_phone_numer?: string;
}

export interface Language {
  id: number;
  name: string;
}

export interface Speciality {
  id: number;
  name: string;
}

export interface HealthMetric {
  id: number;
  user: User;
  created_by?: User;
  measured_by?: User;
  measured_at: string;
  source?: string;
  notes?: string;
  created_at: string;
  updated_at: string;

  // Anthropometrics
  height_cm?: number;
  weight_kg?: number;
  waist_cm?: number;
  hip_cm?: number;
  body_fat_pct?: number;

  // Vital signs
  systolic_bp?: number;
  diastolic_bp?: number;
  heart_rate_bpm?: number;
  respiratory_rate?: number;
  temperature_c?: number;
  spo2_pct?: number;
  pain_score_0_10?: number;

  // Glucose / diabetes
  glucose_fasting_mgdl?: number;
  glucose_random_mgdl?: number;
  hba1c_pct?: number;

  // Lipid panel
  chol_total_mgdl?: number;
  hdl_mgdl?: number;
  ldl_mgdl?: number;
  triglycerides_mgdl?: number;

  // Renal function
  creatinine_mgdl?: number;
  egfr_ml_min_1_73m2?: number;
  bun_mgdl?: number;

  // Liver panel
  alt_u_l?: number;
  ast_u_l?: number;
  alp_u_l?: number;
  bilirubin_total_mgdl?: number;

  // Electrolytes
  sodium_mmol_l?: number;
  potassium_mmol_l?: number;
  chloride_mmol_l?: number;
  bicarbonate_mmol_l?: number;

  // Hematology
  hemoglobin_g_dl?: number;
  wbc_10e9_l?: number;
  platelets_10e9_l?: number;
  inr?: number;

  // Inflammation
  crp_mg_l?: number;
  esr_mm_h?: number;

  // Thyroid
  tsh_miu_l?: number;
  t3_ng_dl?: number;
  t4_ug_dl?: number;

  // Urinalysis
  urine_protein?: boolean;
  urine_glucose?: boolean;
  urine_ketones?: boolean;

  // Respiratory
  peak_flow_l_min?: number;
  fev1_l?: number;
  fvc_l?: number;

  // Mental health
  phq9_score?: number;
  gad7_score?: number;

  // Reproductive
  pregnant_test_positive?: boolean;
}

export interface UpdateUserRequest {
  first_name?: string;
  last_name?: string;
  mobile_phone_numer?: string;
  communication_method?: 'email' | 'sms' | 'whatsapp';
}

