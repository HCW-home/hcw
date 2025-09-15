from zoneinfo import ZoneInfo
from django.utils import timezone
from django.contrib.auth import get_user_model

User = get_user_model()


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
