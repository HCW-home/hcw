import { HttpParams } from '@angular/common/http';
import { BadgeTypeEnum } from '../constants/badge';
import {
  Appointment,
  AppointmentStatus,
  Participant,
  ParticipantStatus,
} from '../../core/models/consultation';

export function getParticipantBadgeType(status: ParticipantStatus | undefined): BadgeTypeEnum {
  switch (status) {
    case 'confirmed':
      return BadgeTypeEnum.green;
    case 'arrived':
      return BadgeTypeEnum.green;
    case 'invited':
      return BadgeTypeEnum.blue;
    case 'draft':
      return BadgeTypeEnum.orange;
    case 'unavailable':
      return BadgeTypeEnum.gray;
    case 'cancelled':
      return BadgeTypeEnum.red;
    default:
      return BadgeTypeEnum.gray;
  }
}

/**
 * Whether the "was it held?" buttons should be offered.
 *
 * Only once the appointment has started — an appointment that hasn't begun
 * cannot have an outcome. Online ones are qualified automatically after the
 * join window, so this is mostly a correction; for in-person ones it is the
 * only way. Already-cancelled and draft appointments are out.
 */
export function canSetAppointmentOutcome(appointment: Appointment): boolean {
  const settled: AppointmentStatus[] = [
    AppointmentStatus.SCHEDULED,
    AppointmentStatus.COMPLETED,
    AppointmentStatus.NOSHOW,
  ];
  if (!settled.includes(appointment.status)) return false;
  return new Date(appointment.scheduled_at) <= new Date();
}

/**
 * Consultation id of an appointment, whatever shape the API used.
 *
 * List endpoints expose a flat `consultation_id`, while the participant detail
 * endpoint nests the whole consultation object; reading either field blindly
 * ends up printing "[object Object]".
 */
export function getAppointmentConsultationId(
  appointment: Appointment | null | undefined
): number | null {
  if (!appointment) return null;
  if (appointment.consultation_id) return appointment.consultation_id;

  const consultation = appointment.consultation;
  if (!consultation) return null;
  return typeof consultation === 'object' ? consultation.id : consultation;
}

export function getParticipantStatusLabel(participant: Participant): string {
  if (participant.status) {
    return participant.status;
  }
  return participant.is_active ? 'active' : 'cancelled';
}

export function getAppointmentBadgeType(status: AppointmentStatus): BadgeTypeEnum {
  switch (status) {
    case AppointmentStatus.DRAFT:
      return BadgeTypeEnum.orange;
    case AppointmentStatus.SCHEDULED:
      return BadgeTypeEnum.green;
    case AppointmentStatus.COMPLETED:
      return BadgeTypeEnum.blue;
    case AppointmentStatus.NOSHOW:
      return BadgeTypeEnum.orange;
    case AppointmentStatus.CANCELLED:
      return BadgeTypeEnum.red;
    default:
      return BadgeTypeEnum.gray;
  }
}

export function getConsultationBadgeType(isClosed: boolean): BadgeTypeEnum {
  return isClosed ? BadgeTypeEnum.gray : BadgeTypeEnum.green;
}

export function getOnlineStatusBadgeType(isOnline: boolean): BadgeTypeEnum {
  return isOnline ? BadgeTypeEnum.green : BadgeTypeEnum.gray;
}

export function toHttpParams(obj: Record<string, unknown>): HttpParams {
  let params = new HttpParams();

  const appendParam = (key: string, value: unknown) => {
    const stringValue =
      value instanceof Date ? value.toISOString() : String(value);
    params = params.append(key, stringValue);
  };

  for (const [key, value] of Object.entries(obj)) {
    if (
      value == null ||
      value === '' ||
      (Array.isArray(value) && value.length === 0)
    ) {
      continue;
    }

    if (Array.isArray(value)) {
      value.forEach(v => appendParam(`${key}[]`, v));
    } else {
      appendParam(key, value);
    }
  }

  return params;
}

export function extractDateFromISO(isoString: string): string {
  const match = isoString.match(/^(\d{4}-\d{2}-\d{2})/);
  return match ? match[1] : '';
}

export function extractTimeFromISO(isoString: string): string {
  const match = isoString.match(/T(\d{2}:\d{2})/);
  return match ? match[1] : '';
}

export function parseDateWithoutTimezone(isoString: string): Date | null {
  const datePart = extractDateFromISO(isoString);
  const timePart = extractTimeFromISO(isoString);
  if (!datePart) return null;

  const [year, month, day] = datePart.split('-').map(Number);
  const [hours, minutes] = timePart ? timePart.split(':').map(Number) : [0, 0];

  return new Date(year, month - 1, day, hours, minutes);
}

export function toFormData<T extends object>(data: Partial<T>): FormData {
  const formData = new FormData();

  Object.entries(data).forEach(([key, value]) => {
    if (value === null || value === undefined) return;

    if (key === 'files' && Array.isArray(value) && value[0] instanceof File) {
      value.forEach(file => formData.append(key, file));
    } else if (Array.isArray(value)) {
      value.forEach(v => {
        if (v !== null && v !== undefined) {
          formData.append(`${key}[]`, String(v));
        }
      });
    } else if (typeof value === 'boolean') {
      formData.append(key, value.toString());
    } else {
      formData.append(key, String(value));
    }
  });

  return formData;
}

/** Display name for a user, falling back to the email then to a dash. */
export function formatUserName(
  user?: { first_name?: string; last_name?: string; email?: string } | null
): string {
  if (!user) return '-';
  const fullName =
    `${user.first_name?.trim() || ''} ${user.last_name?.trim() || ''}`.trim();
  return fullName || user.email || '-';
}

/** Human readable reference of a consultation, e.g. #000029. */
export function formatConsultationId(id: number): string {
  return `#${String(id).padStart(6, '0')}`;
}
