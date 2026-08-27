import { AbstractControl, ValidationErrors, ValidatorFn } from '@angular/forms';

import { isPhoneAcceptable, needsCountryCode } from './phone';

/**
 * The single sign-up / sign-in field: an email address or a phone number.
 *
 * Mirrors `backend/users/identifier.py`, which is the source of truth. The
 * point of validating here at all is the hint: telling someone their number is
 * missing its country code as they type beats a round-trip that just says the
 * value was rejected.
 */

export type IdentifierChannel = 'email' | 'phone';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/** Which channel `value` names, or null when it is neither. */
export function detectChannel(
  value: string | null | undefined,
  region?: string | null,
): IdentifierChannel | null {
  const trimmed = (value || '').trim();
  if (!trimmed) return null;
  // An '@' is the only unambiguous signal: no phone number contains one.
  if (EMAIL_PATTERN.test(trimmed)) return 'email';
  if (isPhoneAcceptable(trimmed, region)) return 'phone';
  return null;
}

/**
 * Validator for the identifier field.
 *
 * Separates "add your country code" from "that is neither an address nor a
 * number", so the form can say something actionable.
 */
export function identifierValidator(region?: string | null): ValidatorFn {
  return (control: AbstractControl): ValidationErrors | null => {
    if (!control.value) return null;
    if (detectChannel(control.value, region)) return null;
    if (needsCountryCode(control.value, region)) {
      return { phoneNeedsCountryCode: true };
    }
    return { invalidIdentifier: true };
  };
}
