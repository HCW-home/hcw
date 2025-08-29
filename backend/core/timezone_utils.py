import pytz
from django.utils import timezone
from django.contrib.auth import get_user_model
from datetime import datetime, date, time

User = get_user_model()


def get_user_timezone(user):
    """
    Get the timezone object for a user.
    Returns UTC if user has no timezone or invalid timezone.
    """
    try:
        if hasattr(user, 'timezone') and user.timezone:
            return pytz.timezone(user.timezone)
    except pytz.exceptions.UnknownTimeZoneError:
        pass
    return pytz.UTC


def user_now(user):
    """
    Get current datetime in user's timezone.
    """
    user_tz = get_user_timezone(user)
    return timezone.now().astimezone(user_tz)


def user_today(user):
    """
    Get today's date in user's timezone.
    """
    return user_now(user).date()


def localize_datetime_for_user(dt, user):
    """
    Convert a naive or aware datetime to user's timezone.
    """
    user_tz = get_user_timezone(user)
    if timezone.is_naive(dt):
        # Assume naive datetime is in UTC
        dt = timezone.make_aware(dt, pytz.UTC)
    return dt.astimezone(user_tz)


def combine_date_time_in_user_timezone(date_obj, time_obj, user):
    """
    Combine a date and time in user's timezone and return as UTC datetime.
    """
    user_tz = get_user_timezone(user)
    naive_datetime = datetime.combine(date_obj, time_obj)
    localized_datetime = user_tz.localize(naive_datetime)
    return localized_datetime.astimezone(pytz.UTC)