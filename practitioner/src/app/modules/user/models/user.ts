import {CommunicationMethodType} from '../constants/user';

export interface ITerm {
  id: number;
  name: string;
  content: string;
  valid_until: string;
}

export interface IOrganisation {
  id: number;
  name: string;
  logo_large?: string;
  logo_small?: string;
  primary_color?: string;
  default_term?: number;
  location_latitude?: number;
  location_longitude?: number;
  street?: string;
  city?: string;
  postal_code?: string;
  country?: string;
}

export interface ILanguage {
  name: string;
  code: string;
}

export interface ISpeciality {
  id: number;
  name: string;
  name_hy?: string;
}

export interface IUser {
  pk: number;
  username?: string;
  email: string;
  first_name: string;
  last_name: string;
  is_active: boolean;
  is_staff: boolean;
  is_superuser: boolean;
  date_joined: string;
  last_login?: string;

  communication_method: CommunicationMethodType;
  mobile_phone_number?: string;
  preferred_language?: string;
  timezone: string;
  languages?: ILanguage[];
  language_ids?: number[];

  app_preferences?: Record<string, unknown>;
  encrypted?: boolean;
  main_organisation?: IOrganisation;
  organisations?: IOrganisation[];
  specialities?: ISpeciality[];
  accepted_term?: ITerm;
}

export interface IUserUpdateRequest {
  first_name?: string;
  last_name?: string;
  mobile_phone_number?: string;
  communication_method?: CommunicationMethodType;
  preferred_language?: string;
  timezone?: string;
  language_ids?: number[];
}
