from zoneinfo import ZoneInfo
from django.conf import settings
from django.http import HttpResponse, JsonResponse
from django.utils import timezone
from django.contrib.auth import get_user_model

User = get_user_model()


class MaintenanceMiddleware:
    """
    Short-circuits every request with a 503 response when MAINTENANCE=True.

    Placed before any middleware that touches the database (django-tenants)
    or Redis (channels/cache), so the maintenance page can be served even
    when those backends are down.
    """

    def __init__(self, get_response):
        self.get_response = get_response
        if not settings.MAINTENANCE:
            from django.core.exceptions import MiddlewareNotUsed
            raise MiddlewareNotUsed()

    def __call__(self, request):
        message = settings.MAINTENANCE_MESSAGE
        retry_after = settings.MAINTENANCE_RETRY_AFTER

        accept = request.META.get("HTTP_ACCEPT", "")
        wants_json = (
            "application/json" in accept
            or request.path.startswith("/api/")
            or request.path.startswith("/fhir/")
        )

        if wants_json:
            response = JsonResponse(
                {"status": "maintenance", "detail": message},
                status=503,
            )
        else:
            html = (
                "<!doctype html><html lang=\"en\"><head>"
                "<meta charset=\"utf-8\"><title>Maintenance</title>"
                "<style>body{font-family:sans-serif;max-width:480px;"
                "margin:10vh auto;padding:2rem;text-align:center;color:#333}"
                "h1{font-size:1.5rem}</style></head><body>"
                f"<h1>Maintenance</h1><p>{message}</p>"
                "</body></html>"
            )
            response = HttpResponse(html, status=503, content_type="text/html")

        response["Retry-After"] = str(retry_after)
        return response


class TimezoneMiddleware:
    """
    Middleware to activate user's timezone for the duration of the request.
    """

    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        if request.user.is_authenticated:
            try:
                if request.user.timezone:
                    user_timezone = ZoneInfo(request.user.timezone)
                    timezone.activate(user_timezone)
                else:
                    timezone.deactivate()
            except Exception:
                # If user has no valid timezone, use default
                timezone.deactivate()
        else:
            timezone.deactivate()

        response = self.get_response(request)

        # Clean up after request
        timezone.deactivate()

        return response
