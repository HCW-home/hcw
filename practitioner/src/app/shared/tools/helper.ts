import { HttpParams } from '@angular/common/http';
import { BadgeTypeEnum } from '../constants/badge';
import { AppointmentStatus, Participant, ParticipantStatus } from '../../core/models/consultation';

export function getParticipantBadgeType(status: ParticipantStatus | undefined): BadgeTypeEnum {
  switch (status) {
    case 'confirmed':
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
