import logging
from datetime import timedelta

import boto3
from asgiref.sync import async_to_sync
from botocore.exceptions import ClientError
from core.celery import app
from channels.layers import get_channel_layer
from constance import config
from django.conf import settings
from django.contrib.auth import get_user_model
from django.contrib.contenttypes.models import ContentType
from django.utils import timezone
from messaging.models import Message
from django_tenants.utils import get_tenant_model, tenant_context

from .assignments import AssignmentManager
from .models import (
    Appointment,
    AppointmentRecording,
    AppointmentStatus,
    Consultation,
    Participant,
    Request,
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
        if (
            appointment.previous_scheduled_at
            and appointment.previous_scheduled_at != appointment.scheduled_at
        ):
            template_system_name = "appointment_updated"
            participants = participants.filter(is_active=True)
        else:
            template_system_name = "invitation_to_appointment"
            participants = participants.filter(is_notified=False)
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
    """Deliver standalone reminders whose next_run_at matches the current minute.

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

            for reminder in Reminder.objects.filter(is_active=True, next_run_at=now):
                Message.objects.create(
                    sent_to=reminder.recipient,
                    sent_by=reminder.created_by,
                    template_system_name="reminder",
                    content_type=ContentType.objects.get_for_model(reminder),
                    object_id=reminder.pk,
                    # No communication_method: the recipient's channel decides.
                )
                reminder.occurrences_sent += 1
                reminder.last_sent_at = now
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
            f"user_{user_pk}",
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
                return

            now = timezone.now()
            cutoff = now - timedelta(hours=hours)
            qs = Consultation.objects.filter(closed_at__isnull=False, closed_at__lte=cutoff)
            count, _ = qs.delete()
            logger.info(f"Auto-deleted {count} closed consultation(s) older than {hours}h")

            # Belt-and-suspenders: temporary consultations that somehow stayed
            # open past the join window are also dropped once their effective
            # end + call_limit + auto_delete_hours has elapsed.
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

    For each temp consultation we look at its latest non-cancelled appointment.
    Effective end is `appointment.end_expected_at` when set, otherwise
    `scheduled_at + default_appointment_duration_in_minutes`. The consultation
    is closed once `now >= effective_end + call_limit_join_minutes`.
    """
    TenantModel = get_tenant_model()
    for tenant in TenantModel.objects.exclude(schema_name="public"):
        with tenant_context(tenant):
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
