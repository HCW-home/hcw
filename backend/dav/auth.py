"""HTTP Basic Auth for the DAV endpoints (discovery, CalDAV, CardDAV).

DAV clients authenticate with a :class:`users.models.DAVAppPassword` only:
account passwords are deliberately rejected here. Basic Auth replays the
credential on every single request from long-lived desktop and mobile clients,
so what travels must stay scoped to one device and be revocable on its own
without touching the account. It also keeps the account password out of a
surface that OpenID-provisioned users have no password for anyway.
"""

import base64

from django.http import HttpResponse

from users.models import DAVAppPassword


def get_user_from_request(request):
    """Return the user behind the Basic Auth header, or None."""
    auth_header = request.META.get("HTTP_AUTHORIZATION", "")
    if not auth_header.startswith("Basic "):
        return None
    try:
        decoded = base64.b64decode(auth_header[6:]).decode("utf-8")
    except Exception:
        return None

    username, _, password = decoded.partition(":")
    if not password:
        return None

    return DAVAppPassword.authenticate(username, password)


def require_auth(request, realm):
    """Return ``(user, None)``, or ``(None, 401 response)`` when unauthenticated."""
    user = get_user_from_request(request)
    if user is None:
        response = HttpResponse("Unauthorized", status=401)
        response["WWW-Authenticate"] = f'Basic realm="{realm}"'
        return None, response
    return user, None
