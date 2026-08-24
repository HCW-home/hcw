
import phonenumbers
from django.core.exceptions import ValidationError
from django.core.validators import RegexValidator
from django.utils.translation import gettext_lazy as _

from .phone import get_default_region, strip_separators

hex_validator = RegexValidator(
    regex=r'^[0-9a-fA-F]+$',
    message='Enter a valid hexadecimal value.'
)


def validate_phone_number(value):
    """Reject values that cannot be a phone number, or that are ambiguous.

    Two separate checks:

    - Without a `default_phone_region`, a national number like '0612345678'
      cannot be resolved to a country, so it is refused outright: storing it
      as-is would defeat the unique constraint (the same person could then also
      exist as '+33612345678') and would give SMS providers a number they
      cannot route. The international notation is required instead.
    - Otherwise only the shape is checked, not that the number is actually
      assigned. A stricter rule would reject legitimate foreign numbers and
      block account creation, whereas the point here is just to stop free text
      like 'abc' from taking the unique phone slot.
    """
    cleaned = strip_separators(value)
    if not cleaned:
        return

    region = get_default_region()
    if region is None and not cleaned.startswith("+"):
        raise ValidationError(
            _(
                "Enter the phone number in international format, "
                "for example +33612345678."
            ),
            code="phone_number_not_international",
        )

    try:
        parsed = phonenumbers.parse(cleaned, region)
    except phonenumbers.NumberParseException:
        raise ValidationError(
            _("Enter a valid phone number."), code="invalid_phone_number"
        )

    if not phonenumbers.is_possible_number(parsed):
        raise ValidationError(
            _("Enter a valid phone number."), code="invalid_phone_number"
        )
