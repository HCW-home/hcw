import pytz
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
                user_timezone = pytz.timezone(request.user.timezone)
                timezone.activate(user_timezone)
            except (AttributeError, pytz.exceptions.UnknownTimeZoneError):
                # If user has no timezone or invalid timezone, use default
                timezone.deactivate()
        else:
            # If user is not authenticated, use default timezone
            timezone.deactivate()

        response = self.get_response(request)
        
        # Clean up after request
        timezone.deactivate()
        
        return response