import { SelectOption } from '../../../shared/models/select';

export enum GenderEnum {
  MALE = 'male',
  FEMALE = 'female',
  OTHER = 'other',
  PREFER_NOT_TO_SAY = 'prefer_not_to_say'
}

export enum CommunicationMethodEnum {
  SMS = 'sms',
  EMAIL = 'email',
  WHATSAPP = 'whatsapp',
  PUSH = 'push',
  MANUAL = 'manual'
}

export enum UserTypeEnum {
  PATIENT = 'patient',
  PRACTITIONER = 'practitioner',
  ADMIN = 'admin'
}

export type CommunicationMethodType = CommunicationMethodEnum;

export const GenderOptions: SelectOption[] = [
  { label: 'Male', value: GenderEnum.MALE },
  { label: 'Female', value: GenderEnum.FEMALE },
  { label: 'Other', value: GenderEnum.OTHER },
  { label: 'Prefer not to say', value: GenderEnum.PREFER_NOT_TO_SAY }
];

export const CommunicationMethodOptions: SelectOption[] = [
  { label: 'SMS', value: CommunicationMethodEnum.SMS },
  { label: 'Email', value: CommunicationMethodEnum.EMAIL },
  { label: 'WhatsApp', value: CommunicationMethodEnum.WHATSAPP },
  { label: 'Push Notification', value: CommunicationMethodEnum.PUSH },
  { label: 'Manual Contact', value: CommunicationMethodEnum.MANUAL }
];
