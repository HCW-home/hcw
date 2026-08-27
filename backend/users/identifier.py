"""Resolve the single sign-up / sign-in field into an email or a phone number.

Patients identify themselves with one input: either an address or a number.
Everything downstream — account lookup, code delivery, throttling — needs to
know which one it got, and needs the canonical form rather than what was typed,
so that '+33 6 12 34 56 78' and '+33612345678' are the same identity.

The phone rules are not reimplemented here: `phone.normalize_phone_number` and
`validators.validate_phone_number` already encode them, including how
constance's `default_phone_region` decides whether a national format is
acceptable.
"""

from django.core.exceptions import ValidationError as DjangoValidationError
from django.core.validators import validate_email
from django.utils.translation import gettext_lazy as _
from rest_framework import serializers

from .phone import normalize_phone_number, strip_separators

EMAIL = "email"
PHONE = "phone"


def resolve_identifier(value):
    """Return ``(EMAIL | PHONE, canonical_value)`` for a typed identifier.

    Raises ``rest_framework.serializers.ValidationError`` when the value is
    neither, reusing the phone validator's wording so the front-end can tell
    "add your country code" from "that is not a number".
    """
    value = (value or "").strip()
    if not value:
        raise serializers.ValidationError(
            _("Enter your email address or phone number.")
        )

    # An '@' is the only unambiguous signal: no phone number contains one, and
    # anything else is worth trying as a number before giving up.
    if "@" in value:
        try:
            validate_email(value)
        except DjangoValidationError:
            raise serializers.ValidationError(_("Enter a valid email address."))
        return EMAIL, value

    try:
        # Imported here: validators imports phone, which reads constance.
        from .validators import validate_phone_number

        validate_phone_number(value)
    except DjangoValidationError as exc:
        raise serializers.ValidationError(list(exc.messages))

    normalized = normalize_phone_number(strip_separators(value))
    return PHONE, normalized
