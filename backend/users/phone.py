import logging
import re

import phonenumbers

logger = logging.getLogger(__name__)

# Longest legal E.164 number is '+' plus 15 digits. The model column is wider
# than that so legacy entries that cannot be parsed still fit after cleaning.
MAX_PHONE_LENGTH = 32

_SEPARATORS = re.compile(r"[\s\-.()]")


def get_default_region():
    """Region used to read a number typed in national format.

    Stored per tenant in Constance so each deployment can accept the local
    notation its users are used to. Imported lazily: this module is reached
    from `User.save()`, and a module-level Constance import would create a
    cycle at app loading time.
    """
    try:
        from constance import config as constance_config

        return getattr(constance_config, "default_phone_region", "") or None
    except Exception:  # Constance unavailable (e.g. early migrations)
        return None


def strip_separators(value):
    """Legacy normalisation: drop separators, keep a leading '+'."""
    if not value:
        return None
    cleaned = _SEPARATORS.sub("", value.strip())
    return cleaned or None


def normalize_phone_number(value, region=None):
    """Return `value` in E.164 form, e.g. '+33612345678'.

    Storing one canonical form is what makes the `unique` constraint on
    User.mobile_phone_number meaningful: without it '0612345678' and
    '+33612345678' are two distinct rows for the same real number, and a
    lookup by either form misses the other.

    Numbers phonenumbers cannot parse or judge valid fall back to the legacy
    separator-free form rather than being dropped, so existing partial or
    exotic entries survive the migration untouched.
    """
    cleaned = strip_separators(value)
    if not cleaned:
        return None

    if region is None:
        region = get_default_region()

    try:
        parsed = phonenumbers.parse(cleaned, region)
    except phonenumbers.NumberParseException:
        return cleaned

    if not phonenumbers.is_valid_number(parsed):
        return cleaned

    return phonenumbers.format_number(parsed, phonenumbers.PhoneNumberFormat.E164)


def phone_lookup_variants(value, region=None):
    """Every stored form `value` may legitimately have, most canonical first.

    Rows written before the E.164 migration, or by a code path that bypassed
    `save()`, may still hold the legacy separator-free form. Callers resolving
    an account by phone must try both or they will create a duplicate.
    """
    variants = []
    for candidate in (
        normalize_phone_number(value, region=region),
        strip_separators(value),
    ):
        if candidate and candidate not in variants:
            variants.append(candidate)
    return variants
