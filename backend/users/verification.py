"""Helpers shared by every flow that authenticates someone with a short code.

Two distinct flows rely on ``User.verification_code``: passwordless login
(``SendVerificationCodeView`` / ``AnonymousTokenAuthView``) and email address
verification after registration. They share the storage but not the entry
point, so the generation and the expiry policy live here.
"""

import secrets
from datetime import timedelta

from django.conf import settings

# How long a code sent to verify an email address stays usable.
EMAIL_VERIFICATION_CODE_TTL = timedelta(
    minutes=getattr(settings, "EMAIL_VERIFICATION_CODE_TTL_MINUTES", 15)
)

# How many wrong codes a single account tolerates before the code is burnt.
MAX_VERIFICATION_ATTEMPTS = getattr(settings, "MAX_VERIFICATION_ATTEMPTS", 3)


def generate_verification_code() -> int:
    """Return a 6-digit code for ``User.verification_code``.

    Values below 100000 are excluded so the code still renders on six digits
    once read back from this IntegerField.
    """
    return 100000 + secrets.randbelow(900000)


def codes_match(expected, provided) -> bool:
    """Compare two verification codes in constant time.

    Both sides are normalised to six characters first: the stored code is an
    integer, the submitted one an arbitrary string.
    """
    if expected is None or provided is None:
        return False
    return secrets.compare_digest(
        str(expected).zfill(6), str(provided).strip().zfill(6)
    )
