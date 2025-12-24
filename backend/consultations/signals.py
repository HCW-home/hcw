from asgiref.sync import async_to_sync
from channels.layers import get_channel_layer
from django.db.models.signals import post_delete, post_save
from django.dispatch import receiver
from livekit.protocol.room import SendDataRequest

from .consumers import get_consultation
from .models import Appointment, AppointmentStatus, Consultation, Request, RequestStatus
from .serializers import ConsultationSerializer


def get_users_to_notification_consultation(consultation: Consultation):
    # Collect users to notify
    users_to_notify_pks = set()

    # Add owned_by user
    if consultation.owned_by:
        users_to_notify_pks.add(consultation.owned_by.pk)

    # Add beneficiary user
    if consultation.beneficiary:
        users_to_notify_pks.add(consultation.beneficiary.pk)

    # Add users from group (queue)
    if consultation.group:
        for user in consultation.group.users.all():
            users_to_notify_pks.add(user.pk)

    return users_to_notify_pks


@receiver(post_save, sender=Consultation)
def consultation_saved(sender, instance: Consultation, created, **kwargs):
    """
    Whenever a Consultation is created/updated, broadcast it over Channels.
    """
    channel_layer = get_channel_layer()

    # Send notifications to each user
    for user_pk in get_users_to_notification_consultation(instance):
        async_to_sync(channel_layer.group_send)(
            f"user_{user_pk}",
            {
                "type": "consultation",
                "consultation_id": instance.pk,
                "state": "created" if created else "updated",
            },
        )


@receiver(post_delete, sender=Consultation)
def consultation_deleted(sender, instance, **kwargs):
    channel_layer = get_channel_layer()
    for user_pk in get_users_to_notification_consultation(instance):
        async_to_sync(channel_layer.group_send)(
            f"user_{user_pk}",
            {
                "type": "consultation",
                "consultation_id": instance.pk,
                "state": "deleted",
            },
        )


@receiver(post_save, sender=Request)
def request_saved(sender, instance, created, **kwargs):
    """
    Whenever a Request is created, trigger the celery task to process it.
    Only trigger for newly created requests with REQUESTED status.
    """
    if created and instance.status == RequestStatus.REQUESTED:
        try:
            # Import the task here to avoid circular imports
            from .tasks import handle_request

            # Trigger the celery task asynchronously
            handle_request.delay(instance.id)
        except Exception as e:
            # Log the error but don't block the request creation
            import logging

            logger = logging.getLogger(__name__)
            logger.error(
                f"Failed to trigger celery task for request {instance.id}: {str(e)}"
            )
            # For debugging: temporarily disable to see if this is the cause
            pass


# @receiver(post_save, sender=Appointment)
# def send_appointment_invites(sender, instance, created, **kwargs):
#     """
#     Prepare invite sending over celery task.
#     """

#     if created and instance.status in [AppointmentStatus.SCHEDULED, AppointmentStatus.CANCELLED]:
#         pass
