import {
  ValidatorFn,
  AbstractControl,
  ValidationErrors
} from '@angular/forms';
import { PhoneNumberFormat, PhoneNumberUtil } from 'google-libphonenumber';

/**
 * Phone helpers mirroring the backend rules in `backend/users/phone.py`.
 *
 * Both sides use the same Google libphonenumber metadata, so a number accepted
 * here is accepted by the API and normalises to the exact same E.164 string.
 * `region` comes from the `default_phone_region` app config: when it is empty
 * the tenant only accepts the international +XX notation, because a national
 * number cannot be resolved to a country.
 */

const phoneUtil = PhoneNumberUtil.getInstance();

/** Strip separators, keeping a leading '+', like the backend does. */
function stripSeparators(value: string | null | undefined): string {
  return (value || '').replace(/[\s\-.()]/g, '').trim();
}

/**
 * Canonical E.164 form of `value`, or null when it is not a usable number.
 *
 * Returning null is what callers use to decide an SMS invite cannot be offered:
 * without a region, a number that does not start with '+' is ambiguous and the
 * API would reject it.
 */
export function normalizePhone(
  value: string | null | undefined,
  region?: string | null
): string | null {
  const cleaned = stripSeparators(value);
  if (!cleaned) return null;
  if (!region && !cleaned.startsWith('+')) return null;

  try {
    const parsed = phoneUtil.parse(cleaned, region || undefined);
    if (!phoneUtil.isValidNumber(parsed)) return null;
    return phoneUtil.format(parsed, PhoneNumberFormat.E164);
  } catch {
    return null;
  }
}

/** Whether `value` can be stored and messaged as a phone number. */
export function isPhoneAcceptable(
  value: string | null | undefined,
  region?: string | null
): boolean {
  return normalizePhone(value, region) !== null;
}

/**
 * Whether `value` is being typed as a phone number rather than a name.
 *
 * Deliberately triggers from the second digit: the point is to help as soon as
 * the intent is visible, so someone typing "06" is told the country code is
 * missing instead of just being shown "no account matches". A single character
 * is not enough — it would fire on the first keystroke of anything.
 */
export function looksLikePhone(value: string | null | undefined): boolean {
  const cleaned = stripSeparators(value);
  return /^\+?[0-9]{2,}$/.test(cleaned);
}

export function phoneValidator(region?: string | null): ValidatorFn {
  return (control: AbstractControl): ValidationErrors | null => {
    if (!control.value) {
      return null;
    }
    if (isPhoneAcceptable(control.value, region)) {
      return null;
    }
    // Distinguish the two failures so the form can tell the user to add the
    // country code rather than just "invalid".
    if (!region && !stripSeparators(control.value).startsWith('+')) {
      return { phoneNotInternational: true };
    }
    return { invalidPhoneNumber: true };
  };
}
