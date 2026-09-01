import logging
from datetime import timedelta

import boto3
from asgiref.sync import async_to_sync
from botocore.exceptions import ClientError
from core.celery import app
from core.channel_groups import user_group
from channels.layers import get_channel_layer
from constance import config
from django.conf import settings
from django.contrib.auth import get_user_model
from django.contrib.contenttypes.models import ContentType
from django.db.models import Count, Q
from django.utils import timezone
from messaging.models import Message
from django_tenants.utils import get_tenant_model, tenant_context

from .assignments import AssignmentManager
from .utils import is_immediate_appointment
from .models import (
    Appointment,
    AppointmentRecording,
    AppointmentStatus,
    Consultation,
    Participant,
    Request,
    Type,
)

User = get_user_model()
logger = logging.getLogger(__name__)


@app.task
def handle_request(request_id):
    """
    Handle a consultation request by processing it based on the reason's assignment method.

    Args:
        request_id: The ID of the Request to process

    Returns:
        dict: Result of the processing with success status and details
    """
    request = Request.objects.get(id=request_id)

    with AssignmentManager(request) as assignment:
        assignment.handler.process()


@app.task
def handle_invites(appointment_id):
    appointment = Appointment.objects.get(pk=appointment_id)
    participants = Participant.objects.filter(is_invited=True, appointment=appointment)

    if appointment.status == AppointmentStatus.scheduled:
        rescheduled = bool(
            appointment.previous_scheduled_at
            and appointment.previous_scheduled_at != appointment.scheduled_at
        )
        if rescheduled:
            participants = participants.filter(is_active=True)
        else:
            participants = participants.filter(is_notified=False)

        # Appointment landing inside the window it can already be joined in:
        # asking to confirm a presence, or announcing a move to a time that is
        # already here, would both be answered after the call is over. Invite
        # them to join straight away instead.
        if is_immediate_appointment(appointment):
            template_system_name = "invitation_to_ongoing_appointment"
        elif rescheduled:
            template_system_name = "appointment_updated"
        else:
            template_system_name = "invitation_to_appointment"
    elif appointment.status == AppointmentStatus.cancelled:
        template_system_name = "appointment_cancelled"
    else:
        "Do nothing"
        return

    for participant in participants:
        if not participant.is_active:
            template_system_name = "appointment_cancelled"

        # Don't notify creator
        if appointment.created_by == participant.user:
            continue

        message = Message.objects.create(
            communication_method=participant.user.communication_method,
            recipient_phone=participant.user.mobile_phone_number,
            recipient_email=participant.user.email,
            sent_to=participant.user,
            sent_by=appointment.created_by,
            template_system_name=template_system_name,
            content_type=ContentType.objects.get_for_model(participant),
            object_id=participant.pk,
        )
        participant.is_notified = True
        participant.save(update_fields=["is_notified"])


@app.task
def notify_ongoing_appointment_invite(appointment_id, user_ids):
    """Tell participants added mid-call that the meeting is already running.

    The regular `invitation_to_appointment` template announces a future
    appointment, which reads wrong when the call has already started: these
    people need a "join now" link instead.
    """
    appointment = Appointment.objects.get(pk=appointment_id)
    participants = Participant.objects.filter(
        appointment=appointment,
        user_id__in=user_ids,
        is_active=True,
        is_invited=True,
    ).select_related("user")

    for participant in participants:
        # Don't notify creator
        if appointment.created_by == participant.user:
            continue

        Message.objects.create(
            communication_method=participant.user.communication_method,
            recipient_phone=participant.user.mobile_phone_number,
            recipient_email=participant.user.email,
            sent_to=participant.user,
            sent_by=appointment.created_by,
            template_system_name="invitation_to_ongoing_appointment",
            content_type=ContentType.objects.get_for_model(participant),
            object_id=participant.pk,
        )
        # Mark as notified so the scheduled-invite flow doesn't send a second,
        # contradictory message for the same appointment.
        participant.is_notified = True
        participant.save(update_fields=["is_notified"])


@app.task
def handle_reminders():
    now = timezone.now().replace(second=0, microsecond=0)
    TenantModel = get_tenant_model()
    for tenant in TenantModel.objects.exclude(schema_name='public'):
        with tenant_context(tenant):
            for reminder in ["appointment_first_reminder", "appointment_last_reminder"]:
                reminder_datetime = now + timedelta(minutes=int(getattr(config, reminder)))
                for appointment in Appointment.objects.filter(
                    scheduled_at=reminder_datetime, status=AppointmentStatus.scheduled
                ):
                    for participant in Participant.objects.filter(
                        appointment=appointment, is_active=True
                    ):
                        Message.objects.create(
                            sent_to=participant.user,
                            template_system_name=reminder,
                            content_type=ContentType.objects.get_for_model(participant),
                            object_id=participant.pk,
                        )


@app.task
def handle_custom_reminders():
    """Deliver standalone reminders that are due (next_run_at <= now).

    Uses ``<= now`` rather than ``== now`` so a missed beat (worker downtime,
    deploy, overload) still gets delivered on the next run instead of being
    skipped forever. For recurring reminders, ``compute_next_run_at`` advances
    one step per delivery, so a backlog is caught up one occurrence at a time.

    Creates a Message rendered through the ``reminder`` template (the reminder
    itself is the template ``obj``) per due reminder; its post_save signal
    triggers send_message, routing to the recipient's configured channel
    (SMS/email/WhatsApp). Recurring reminders are rescheduled in place until
    their occurrence count is exhausted.
    """
    now = timezone.now().replace(second=0, microsecond=0)
    TenantModel = get_tenant_model()
    for tenant in TenantModel.objects.exclude(schema_name="public"):
        with tenant_context(tenant):
            from .models import Reminder

            due = Reminder.objects.filter(
                is_active=True, next_run_at__isnull=False, next_run_at__lte=now
            )
            for reminder in due:
                # Catch up every occurrence that should already have been sent
                # (e.g. after downtime), one Message per missed occurrence.
                while (
                    reminder.is_active
                    and reminder.next_run_at is not None
                    and reminder.next_run_at <= now
                ):
                    occurrence_at = reminder.next_run_at
                    Message.objects.create(
                        sent_to=reminder.recipient,
                        sent_by=reminder.created_by,
                        template_system_name="reminder",
                        content_type=ContentType.objects.get_for_model(reminder),
                        object_id=reminder.pk,
                        # No communication_method: the recipient's channel decides.
                    )
                    reminder.occurrences_sent += 1
                    reminder.last_sent_at = occurrence_at
                    nxt = reminder.compute_next_run_at()
                    reminder.is_active = nxt is not None
                    reminder.next_run_at = nxt
                reminder.save(
                    update_fields=[
                        "occurrences_sent",
                        "last_sent_at",
                        "next_run_at",
                        "is_active",
                    ]
                )


@app.task(
    bind=True,
    max_retries=settings.RECORDING_CHECK_MAX_RETRIES,
    default_retry_delay=settings.RECORDING_CHECK_RETRY_DELAY,
)
def check_recording_ready(self, recording_id):
    """
    Check if a recording file has been uploaded to S3 after recording stops.
    Initial delay is set via apply_async(countdown=120).
    Retries up to 4 times with 30s between each retry (~3.5 min total window).
    """
    from .models import Message as ConsultationMessage
    from .serializers import ConsultationMessageSerializer
    from .signals import get_users_to_notification_consultation

    try:
        recording = AppointmentRecording.objects.get(pk=recording_id)
    except AppointmentRecording.DoesNotExist:
        logger.error(f"AppointmentRecording {recording_id} not found")
        return

    # Already processed (duplicate task guard)
    if recording.message_id:
        return

    # Check if file exists in S3
    s3 = boto3.client(
        "s3",
        endpoint_url=settings.LIVEKIT_S3_ENDPOINT_URL,
        aws_access_key_id=settings.LIVEKIT_S3_ACCESS_KEY,
        aws_secret_access_key=settings.LIVEKIT_S3_SECRET_KEY,
        region_name=settings.LIVEKIT_S3_REGION,
        config=boto3.session.Config(signature_version="s3v4"),
    )

    try:
        s3.head_object(Bucket=settings.LIVEKIT_S3_BUCKET_NAME, Key=recording.filepath)
    except ClientError as e:
        if e.response["Error"]["Code"] in ("404", "NoSuchKey"):
            logger.info(f"Recording {recording.filepath} not in S3 yet, retrying...")
            raise self.retry()
        raise

    # File confirmed in S3 — create message
    appointment = recording.appointment
    message = ConsultationMessage.objects.create(
        consultation=appointment.consultation,
        created_by=appointment.consultation.created_by,
        content=f"Recording: Appointment on {appointment.scheduled_at.strftime('%Y-%m-%d %H:%M')}",
        event="recording_available",
        recording_url=recording.filepath,
    )

    # Link message to recording row
    recording.message = message
    recording.save(update_fields=["message"])

    # WebSocket notification
    channel_layer = get_channel_layer()
    message_data = ConsultationMessageSerializer(message).data
    for user_pk in get_users_to_notification_consultation(appointment.consultation):
        async_to_sync(channel_layer.group_send)(
            user_group(user_pk),
            {
                "type": "message",
                "event": "message",
                "consultation_id": appointment.consultation.pk,
                "message_id": message.id,
                "state": "created",
                "data": message_data,
            },
        )

    logger.info(
        f"Recording message created for AppointmentRecording {recording_id}: message {message.id}"
    )


@app.task
def auto_delete_closed_consultations():
    TenantModel = get_tenant_model()
    for tenant in TenantModel.objects.exclude(schema_name='public'):
        with tenant_context(tenant):
            hours = int(config.consultation_auto_delete_hours)
            if hours == 0:
                logger.info("Auto-delete of closed consultations is disabled (0 hours)")
                continue

            now = timezone.now()
            cutoff = now - timedelta(hours=hours)
            qs = Consultation.objects.filter(closed_at__isnull=False, closed_at__lte=cutoff)
            count, _ = qs.delete()
            logger.info(f"Auto-deleted {count} closed consultation(s) older than {hours}h")

            # Belt-and-suspenders: temporary consultations that somehow stayed
            # open past the join window are also dropped once their effective
            # end + call_limit + auto_delete_hours has elapsed. Only when
            # auto-close is enabled; otherwise temporaries are meant to persist
            # until closed manually, so we leave them untouched.
            if not config.auto_close_temporary_consultations:
                continue
            join_limit = int(config.call_limit_join_minutes)
            default_duration = int(config.default_appointment_duration_in_minutes)
            delete_threshold = timedelta(hours=hours)

            temp_qs = Consultation.objects.filter(
                temporary=True, closed_at__isnull=True
            )
            temp_deleted = 0
            for consultation in temp_qs:
                appt = (
                    consultation.appointments.exclude(
                        status=AppointmentStatus.cancelled
                    )
                    .order_by("-scheduled_at")
                    .first()
                )
                if appt:
                    end = appt.end_expected_at or (
                        appt.scheduled_at + timedelta(minutes=default_duration)
                    )
                    expires_at = end + timedelta(minutes=join_limit)
                else:
                    expires_at = consultation.created_at

                if now >= expires_at + delete_threshold:
                    consultation.delete()
                    temp_deleted += 1

            if temp_deleted:
                logger.info(
                    f"Auto-deleted {temp_deleted} unclosed temporary consultation(s) past auto-delete threshold"
                )


@app.task
def auto_close_temporary_consultations():
    """Close temporary consultations whose appointment join window has elapsed.

    No-op unless the `auto_close_temporary_consultations` setting is enabled;
    when disabled, temporary consultations stay open until closed manually.

    For each temp consultation we look at its latest non-cancelled appointment.
    Effective end is `appointment.end_expected_at` when set, otherwise
    `scheduled_at + default_appointment_duration_in_minutes`. The consultation
    is closed once `now >= effective_end + call_limit_join_minutes`.
    """
    TenantModel = get_tenant_model()
    for tenant in TenantModel.objects.exclude(schema_name="public"):
        with tenant_context(tenant):
            if not config.auto_close_temporary_consultations:
                continue
            now = timezone.now()
            join_limit = int(config.call_limit_join_minutes)
            default_duration = int(config.default_appointment_duration_in_minutes)

            qs = Consultation.objects.filter(
                temporary=True, closed_at__isnull=True
            )
            closed = 0
            for consultation in qs:
                appt = (
                    consultation.appointments.exclude(
                        status=AppointmentStatus.cancelled
                    )
                    .order_by("-scheduled_at")
                    .first()
                )
                if not appt:
                    consultation.closed_at = now
                    consultation.save(update_fields=["closed_at"])
                    closed += 1
                    continue

                end = appt.end_expected_at or (
                    appt.scheduled_at + timedelta(minutes=default_duration)
                )
                if now >= end + timedelta(minutes=join_limit):
                    consultation.closed_at = now
                    consultation.save(update_fields=["closed_at"])
                    closed += 1

            if closed:
                logger.info(
                    f"Auto-closed {closed} temporary consultation(s) past join window"
                )


@app.task
def resolve_appointment_outcomes():
    """Close out past online appointments as completed or no-show.

    Participants are flagged as arrived by the join endpoints. Once the join
    window has elapsed, an appointment with at least two arrived participants
    took place; otherwise nobody (or only one side) showed up.

    Only `scheduled` rows are eligible, so a status set by hand is never
    overwritten. In-person appointments have no join step and are left alone:
    they are qualified manually.
    """
    TenantModel = get_tenant_model()
    for tenant in TenantModel.objects.exclude(schema_name="public"):
        with tenant_context(tenant):
            if not config.enable_appointment_outcome_detection:
                continue

            now = timezone.now()
            trailing = timedelta(minutes=int(config.call_limit_join_minutes))
            lookback = timedelta(days=int(config.appointment_outcome_lookback_days))
            default_duration = int(config.default_appointment_duration_in_minutes)

            # scheduled_at is a necessary (not sufficient) bound, kept so the
            # query stays indexed; the real end is re-checked per row below
            # because end_expected_at can push it much further out.
            qs = Appointment.objects.filter(
                status=AppointmentStatus.scheduled,
                type=Type.online,
                scheduled_at__isnull=False,
                scheduled_at__lte=now - trailing,
                scheduled_at__gte=now - lookback,
            ).annotate(
                active_count=Count(
                    "participant", filter=Q(participant__is_active=True)
                ),
                arrived_count=Count(
                    "participant",
                    filter=Q(
                        participant__is_active=True,
                        participant__arrived_at__isnull=False,
                    ),
                ),
            )

            completed = noshow = 0
            for appointment in qs.iterator():
                end = appointment.end_expected_at or (
                    appointment.scheduled_at + timedelta(minutes=default_duration)
                )
                if now < end + trailing:
                    continue

                # Two attendees mean the consultation happened; fall back to the
                # roster size so a one-participant appointment isn't doomed.
                threshold = min(2, appointment.active_count) or 1
                if appointment.arrived_count >= threshold:
                    appointment.status = AppointmentStatus.completed
                    completed += 1
                else:
                    appointment.status = AppointmentStatus.noshow
                    noshow += 1
                appointment.save(update_fields=["status", "updated_at"])

            if completed or noshow:
                logger.info(
                    f"Appointment outcomes ({tenant.schema_name}): "
                    f"{completed} completed, {noshow} no-show"
                )
