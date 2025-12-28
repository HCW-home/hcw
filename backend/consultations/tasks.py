import logging

from celery import shared_task
from django.contrib.auth import get_user_model
from django.forms.models import model_to_dict
from messaging.models import Message

from .assignments import AssignmentManager
from .models import Appointment, AppointmentStatus, Request

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

    if appointment.status == AppointmentStatus.SCHEDULED:
        template_system_name = "invitation_to_appointment"
    elif appointment.status == AppointmentStatus.CANCELLED:
        template_system_name = "cancelling_appointment"
    else:
        "Do nothing"
        return

    for participant in appointment.participants.filter(
        is_invited=True, is_notified=False
    ):
        message = Message.objects.create(
            communication_method=participant.communication_method,
            recipient_phone=participant.phone,
            recipient_email=participant.email,
            sent_to=participant.user,
            sent_by=appointment.consultation.created_by,
            template_system_name=template_system_name,
            object_dict=model_to_dict(participant),
        )
        message.send()
        participant.is_notified = True
