from datetime import timedelta

from constance import config
from django.utils import timezone


def appointment_active_cutoff():
    """Return the datetime before which an appointment is considered finished.

    An appointment is "still active" while its scheduled_at is more recent than
    this cutoff: the default appointment duration plus the late-join tolerance.
    Used by listings, dashboards and filters that need to surface ongoing or
    just-finished appointments.
    """
    minutes = (
        int(config.default_appointment_duration_in_minutes)
        + int(config.call_limit_join_minutes)
    )
    return timezone.now() - timedelta(minutes=minutes)
