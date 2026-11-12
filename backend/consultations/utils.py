from datetime import timedelta

from constance import config
from django.db.models import Q
from django.utils import timezone


def appointment_active_cutoff():
    """Return the datetime before which an appointment *without an explicit end*
    is considered finished.

    An appointment is "still active" while its scheduled_at is more recent than
    this cutoff: the default appointment duration plus the late-join tolerance.

    Prefer :func:`appointment_active_q` for anything that filters appointments:
    this helper cannot account for ``end_expected_at`` and so cuts a long
    appointment short.
    """
    minutes = (
        int(config.default_appointment_duration_in_minutes)
        + int(config.call_limit_join_minutes)
    )
    return timezone.now() - timedelta(minutes=minutes)


def appointment_active_q(prefix=""):
    """Q matching appointments that are still upcoming or ongoing.

    An appointment stays active until its end plus ``call_limit_join_minutes``
    (the window during which participants can still rejoin). The end is
    ``end_expected_at`` when set, otherwise
    ``scheduled_at + default_appointment_duration_in_minutes`` — the same rule
    the auto-close and outcome-detection tasks apply.

    ``prefix`` is the relation to traverse, e.g. ``appointment_active_q(
    "appointments")`` for a queryset of consultations.
    """
    now = timezone.now()
    join_limit = int(config.call_limit_join_minutes)
    default_duration = int(config.default_appointment_duration_in_minutes)

    end_cutoff = now - timedelta(minutes=join_limit)
    start_cutoff = now - timedelta(minutes=default_duration + join_limit)

    field = f"{prefix}__" if prefix else ""
    return Q(
        **{
            f"{field}end_expected_at__isnull": False,
            f"{field}end_expected_at__gte": end_cutoff,
        }
    ) | Q(
        **{
            f"{field}end_expected_at__isnull": True,
            f"{field}scheduled_at__gte": start_cutoff,
        }
    )


def is_appointment_active(appointment, now=None):
    """Python-side counterpart of :func:`appointment_active_q` for one instance.

    Use it when the appointment is already loaded (serializers, single-object
    checks) so the same rule applies as in the querysets.
    """
    if appointment is None or appointment.scheduled_at is None:
        return False

    now = now or timezone.now()
    join_limit = int(config.call_limit_join_minutes)
    end = appointment.end_expected_at or (
        appointment.scheduled_at
        + timedelta(minutes=int(config.default_appointment_duration_in_minutes))
    )
    return end + timedelta(minutes=join_limit) >= now
