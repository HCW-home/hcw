"""Helpers shared by every flow that authenticates someone with a short code.

Two distinct flows rely on ``User.verification_code``: passwordless login
(``SendVerificationCodeView`` / ``AnonymousTokenAuthView``) and email address
verification after registration. They share the storage but not the entry
point, so the generation and the expiry policy live here.
"""

import secrets
from datetime import timedelta

from django.conf import settings
from django.core import signing
from django.db import connection

# How long a code stays usable once issued, whichever flow sent it.
VERIFICATION_CODE_TTL = timedelta(
    minutes=getattr(settings, "VERIFICATION_CODE_TTL_MINUTES", 15)
)

# A code asked for again within this window is sent again unchanged, so every
# message received in the meantime carries a code that still works.
VERIFICATION_CODE_REUSE_WINDOW = timedelta(
    minutes=getattr(settings, "VERIFICATION_CODE_REUSE_MINUTES", 5)
)

# Shortest gap between two messages carrying the same code. The apps hold their
# "resend" button for as long; this absorbs reloads and extra tabs.
VERIFICATION_CODE_RESEND_DELAY = timedelta(
    seconds=getattr(settings, "VERIFICATION_CODE_RESEND_DELAY_SECONDS", 30)
)

# How many wrong codes a single account tolerates before the code is burnt.
MAX_VERIFICATION_ATTEMPTS = getattr(settings, "MAX_VERIFICATION_ATTEMPTS", 3)

# How long a freshly minted magic link, or one just confirmed with a code,
# signs its holder in without asking for a code.
TOKEN_GRACE_PERIOD = timedelta(
    minutes=getattr(settings, "TOKEN_GRACE_PERIOD_MINUTES", 5)
)

CODE_LOGIN_TOKEN_SALT = "users.verification.code-login"


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


def code_login_token(user) -> str:
    """Token the login form sends back to AnonymousTokenAuthView with the code.

    Deliberately not ``one_time_auth_token``. That one is the magic link
    already delivered by message, and handing it to whoever types an address
    would let them use it wherever the link alone is enough. This one only
    ever opens a session together with the code, needs no storage, and stays
    valid however many times the code is asked for, so every tab showing the
    code form keeps working.
    """
    return signing.dumps(
        {"user": user.pk, "schema": connection.schema_name},
        salt=CODE_LOGIN_TOKEN_SALT,
    )


def read_code_login_token(token):
    """Return the pk of the user a ``code_login_token`` was issued to.

    Raises ``signing.SignatureExpired`` once the token has outlived any code it
    could go with, and ``signing.BadSignature`` for anything else, magic-link
    tokens included. The schema check stops a token minted on one tenant from
    naming whoever holds the same pk on another.
    """
    if not isinstance(token, str):
        raise signing.BadSignature("Code login token must be a string.")
    payload = signing.loads(
        token, salt=CODE_LOGIN_TOKEN_SALT, max_age=VERIFICATION_CODE_TTL
    )
    if not isinstance(payload, dict) or payload.get("schema") != connection.schema_name:
        raise signing.BadSignature("Code login token issued for another tenant.")
    return payload.get("user")
