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


def roster_access_q(user, prefix="appointments"):
    """Q on Consultation matching the rosters that open it to ``user``.

    ``is_consultation_visible`` decides alone, whoever the participant is: it
    is the box the organiser ticks when adding someone, and a practitioner is
    no exception — unticking it and still handing them the follow-up would make
    the choice a decoration. The box defaults to ticked, so a colleague added
    to an appointment does get the chat unless it is explicitly taken away, and
    the practitioners who carry the case reach it as owner, creator or member
    of its queue rather than through a roster row.

    ``prefix`` is the relation to traverse from the queried model, e.g. the
    default ``"appointments"`` for a Consultation queryset.
    """
    field = f"{prefix}__participant__"
    return Q(
        **{
            f"{field}user": user,
            f"{field}is_active": True,
            f"{field}is_consultation_visible": True,
        }
    )


def roster_participant_q(consultation):
    """Q on Participant matching the roster rows that open ``consultation``.

    Participant-side counterpart of :func:`roster_access_q`, for the code that
    starts from the roster rather than from the consultation (real-time fan-out,
    encryption key allow-list).
    """
    return Q(
        appointment__consultation=consultation,
        is_active=True,
        is_consultation_visible=True,
    )


def consultation_access_q(user):
    """Q on Consultation matching every consultation ``user`` may read.

    The single expression of the access rule: a consultation opens to its
    creator, its owner, its beneficiary, the members of its queue, or the
    rosters of its appointments (see :func:`roster_access_q`). Anything reading
    consultation content — a queryset, a nested serializer, a socket — must
    gate on this and nothing wider.

    ``visible_by_patient`` is what hides a follow-up from the person it
    concerns, so the beneficiary branch carries it. A temporary consultation —
    the chat container spun up for an appointment booked outside any follow-up
    — is no exception: its participants are on a roster like any other, so the
    visibility box decides there too. Whoever booked the appointment owns that
    container and reaches it as its creator.
    """
    return (
        Q(created_by=user)
        | Q(owned_by=user)
        | Q(beneficiary=user, visible_by_patient=True)
        | Q(group__users=user)
        | roster_access_q(user)
    )


def can_access_consultation(user, consultation):
    """Whether ``user`` may read ``consultation``.

    Single-instance counterpart of :func:`consultation_access_q`, for the code
    that already holds the consultation (nested serializers, socket handshakes)
    and cannot express the rule as a queryset filter.
    """
    from .models import Consultation

    if consultation is None or not getattr(user, "is_authenticated", False):
        return False
    return (
        Consultation.objects.filter(pk=consultation.pk)
        .filter(consultation_access_q(user))
        .exists()
    )
