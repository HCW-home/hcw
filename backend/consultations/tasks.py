import logging
from datetime import timedelta

from celery import shared_task
from constance import config
from django.contrib.auth import get_user_model
from django.utils import timezone
from messaging.models import Message

from .assignments import AssignmentManager
from .models import Appointment, AppointmentStatus, Request, Participant

User = get_user_model()
logger = logging.getLogger(__name__)


@shared_task
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


@shared_task
def handle_invites(appointment_id):
    appointment = Appointment.objects.get(pk=appointment_id)
    participants = Participant.objects.filter(
        is_invited=True, is_active=True, appointment=appointment)

    if appointment.status == AppointmentStatus.scheduled:
        if appointment.previous_scheduled_at:
            template_system_name = "appointment_updated"
        else:
            template_system_name = "invitation_to_appointment"
            participants = participants.filter(is_notified=False)
    elif appointment.status == AppointmentStatus.cancelled:
        template_system_name = "appointment_cancelled"
    else:
        "Do nothing"
        return

    for participant in participants:
        message = Message.objects.create(
            communication_method=participant.user.communication_method,
            recipient_phone=participant.user.mobile_phone_number,
            recipient_email=participant.user.email,
            sent_to=participant.user,
            sent_by=appointment.consultation.created_by,
            template_system_name=template_system_name,
            object_pk=participant.pk,
            object_model="consultations.Participant",
        )
        message.send()
        participant.is_notified = True
        participant.save(update_fields=['is_notified'])


@shared_task
def handle_reminders():
    now = timezone.now().replace(second=0, microsecond=0)

    # Handle first reminder
    for reminder in ["appointment_first_reminder", "appointment_last_reminder"]:
        reminder_datetime = now + timedelta(minutes=int(getattr(config, reminder)))
        for appointment in Appointment.objects.filter(
            scheduled_at=reminder_datetime, status=AppointmentStatus.scheduled
        ):
            for participant in appointment.participants.filter(is_active=True):
                Message.objects.create(
                    sent_to=participant.user,
                    template_system_name="appointment_first_reminder",
                    object_pk=participant.pk,
                    object_model="consultations.Participant",
                )
