export interface User {
  id: number;
  pk: number;
  username: string;
  email: string;
  first_name: string;
  last_name: string;
  picture?: string;
  preferred_language?: string;
  timezone?: string;
  mobile_phone_number?: string;
  communication_method?: 'EMAIL' | 'SMS' | 'WHATSAPP';
  is_online?: boolean;
  app_preferences?: any;
  location?: string;
  date_joined?: string;
  last_login?: string;
  weight: string;
  height: string;
  blood_type: string;
  gender: string;
  phone: string;
  date_of_birth: string;
  address: string;
  one_time_auth_token?: string;
  is_auth_token_used?: boolean;
  verification_code?: number | null;
}

export interface LoginRequest {
  email: string;
  password: string;
}

export interface LoginResponse {
  key?: string;
  access?: string;
  refresh?: string;
  user?: User;
}

export interface RegisterRequest {
  username: string;
  email: string;
  password1: string;
  password2: string;
  first_name?: string;
  last_name?: string;
}

export interface MagicLinkRequest {
  email?: string;
  phone?: string;
}

export interface MagicLinkVerify {
  token: string;
}

export interface TokenAuthRequest {
  auth_token: string;
  verification_code?: string;
}

export interface TokenAuthResponse {
  access?: string;
  refresh?: string;
  user_id?: number;
  requires_verification?: boolean;
  message?: string;
  error?: string;
}
