"""Rate limiting for sensitive endpoints.

Two mechanisms live here:

* DRF ``SimpleRateThrottle`` subclasses for API (``APIView``) endpoints. Rates
  are configured in ``REST_FRAMEWORK["DEFAULT_THROTTLE_RATES"]`` and referenced
  by scope.
* A small cache-based ``ratelimit`` decorator for plain Django class-based
  views (admin login selector, DAV) that never enter DRF's request cycle.

Both rely on the shared Django cache (Redis in production, LocMemCache in
development). Unlike django-ratelimit, nothing hard-fails a Django system check
when the cache is not "shared": throttling simply degrades to per-process
counters in development, which is acceptable there while staying correct in
production behind Redis.
"""

from functools import wraps

from django.core.cache import cache
from django.http import HttpResponse
from rest_framework.throttling import SimpleRateThrottle


def get_client_ip(request):
    """Return the client IP, honouring X-Forwarded-For behind a reverse proxy."""
    forwarded = request.META.get("HTTP_X_FORWARDED_FOR")
    if forwarded:
        return forwarded.split(",")[0].strip()
    return request.META.get("REMOTE_ADDR", "")


class IPRateThrottle(SimpleRateThrottle):
    """Throttle by client IP, reading the real IP from X-Forwarded-For."""

    def get_cache_key(self, request, view):
        ident = get_client_ip(request)
        if not ident:
            return None
        return self.cache_format % {"scope": self.scope, "ident": ident}


class LoginRateThrottle(IPRateThrottle):
    scope = "login"


class PasswordResetRateThrottle(IPRateThrottle):
    scope = "password_reset"


class PasswordResetConfirmRateThrottle(IPRateThrottle):
    scope = "password_reset_confirm"


class EmailVerifyRateThrottle(IPRateThrottle):
    scope = "email_verify"


class RegistrationRateThrottle(IPRateThrottle):
    """Burst cap on sign-ups.

    Pair it with ``RegistrationDailyRateThrottle``: a per-minute cap alone still
    leaves room to create thousands of accounts a day (and to send as many
    verification emails from this instance).
    """

    scope = "registration"


class RegistrationDailyRateThrottle(IPRateThrottle):
    scope = "registration_day"


class AnonymousTokenRateThrottle(IPRateThrottle):
    scope = "anonymous_token"


class OpenIDRateThrottle(IPRateThrottle):
    scope = "openid"


class VerificationCodeIPRateThrottle(IPRateThrottle):
    scope = "verification_code_ip"


class VerificationCodeRateThrottle(SimpleRateThrottle):
    """Throttle verification-code requests per IP + target email.

    Keying on the email as well as the IP prevents a single address from being
    spammed with codes. Pair it with ``VerificationCodeIPRateThrottle`` to also
    cap how many distinct emails one IP can target.
    """

    scope = "verification_code"

    def get_cache_key(self, request, view):
        email = (request.data.get("email") or "").strip().lower()
        if not email:
            return None  # Nothing to throttle on this dimension.
        ident = f"{get_client_ip(request)}:{email}"
        return self.cache_format % {"scope": self.scope, "ident": ident}


_PERIODS = {"s": 1, "m": 60, "h": 3600, "d": 86400}


def _parse_rate(rate):
    """Parse a ``'<count>/<period>'`` rate string into ``(count, seconds)``.

    Accepts an optional multiplier on the period, e.g. ``'5/min'``, ``'30/m'``
    or ``'100/10m'``.
    """
    count, _, period = rate.partition("/")
    unit = period[-1:] if period else "m"
    multiplier = period[:-1]
    seconds = _PERIODS.get(unit, 60) * (int(multiplier) if multiplier.isdigit() else 1)
    return int(count), seconds


def ratelimit(rate, methods=None, scope=None):
    """Rate-limit a plain Django (non-DRF) view by client IP.

    Counts requests over a fixed window using the Django cache and returns HTTP
    429 once the limit is exceeded. Only ``methods`` are throttled (all methods
    when ``None``). Meant to wrap ``dispatch`` via ``method_decorator``.
    """
    count, window = _parse_rate(rate)

    def decorator(view_func):
        bucket = scope or view_func.__qualname__

        @wraps(view_func)
        def wrapper(request, *args, **kwargs):
            if methods is None or request.method in methods:
                ident = get_client_ip(request)
                key = f"rl:{bucket}:{request.method}:{ident}"
                # get_or_set seeds the counter and its TTL atomically; the
                # window then stays anchored to the first request since incr
                # preserves the existing expiry.
                if cache.get_or_set(key, 0, window) >= count:
                    response = HttpResponse("Too many requests", status=429)
                    response["Retry-After"] = str(window)
                    return response
                try:
                    cache.incr(key)
                except ValueError:
                    # Key expired between get_or_set and incr: start a new window.
                    cache.set(key, 1, window)
            return view_func(request, *args, **kwargs)

        return wrapper

    return decorator
