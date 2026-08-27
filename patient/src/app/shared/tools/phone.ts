import { parsePhoneNumberFromString, CountryCode } from 'libphonenumber-js';

/**
 * Phone helpers mirroring the backend rules in `backend/users/phone.py`.
 *
 * `region` comes from the `default_phone_region` app config: when it is empty
 * the tenant only accepts the international +XX notation, because a national
 * number cannot be resolved to a country.
 *
 * Acceptance is checked with `isPossible()`, not `isValid()`, to match
 * `backend/users/validators.py`: the API only rejects what cannot be a number
 * at all, since a stricter rule would turn away legitimate foreign numbers and
 * block sign-up. Being stricter here would refuse numbers the API accepts.
 */

/** Strip separators, keeping a leading '+', like the backend does. */
export function stripSeparators(value: string | null | undefined): string {
  return (value || '').replace(/[\s\-.()]/g, '').trim();
}

/**
 * Canonical E.164 form of `value`, or null when it is not a usable number.
 *
 * Returning null is what callers use to decide the value is not a phone
 * number: without a region, a number that does not start with '+' is ambiguous
 * and the API would reject it.
 */
export function normalizePhone(
  value: string | null | undefined,
  region?: string | null,
): string | null {
  const cleaned = stripSeparators(value);
  if (!cleaned) return null;
  if (!region && !cleaned.startsWith('+')) return null;

  try {
    const parsed = parsePhoneNumberFromString(
      cleaned,
      (region || undefined) as CountryCode | undefined,
    );
    if (!parsed || !parsed.isPossible()) return null;
    return parsed.number;
  } catch {
    return null;
  }
}

/** Whether `value` can be stored and messaged as a phone number. */
export function isPhoneAcceptable(
  value: string | null | undefined,
  region?: string | null,
): boolean {
  return normalizePhone(value, region) !== null;
}

/**
 * Whether `value` is being typed as a phone number rather than an address.
 *
 * Deliberately triggers from the second digit: the point is to help as soon as
 * the intent is visible, so someone typing "06" is told the country code is
 * missing instead of just being shown "invalid". A single character is not
 * enough — it would fire on the first keystroke of anything.
 */
export function looksLikePhone(value: string | null | undefined): boolean {
  return /^\+?[0-9]{2,}$/.test(stripSeparators(value));
}

/** Whether the value is a number missing the country code the tenant needs. */
export function needsCountryCode(
  value: string | null | undefined,
  region?: string | null,
): boolean {
  return !region && looksLikePhone(value) && !stripSeparators(value).startsWith('+');
}
