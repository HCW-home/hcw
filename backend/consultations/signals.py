from asgiref.sync import async_to_sync
from channels.layers import get_channel_layer
from django.db.models.signals import post_delete, post_save, pre_save
from django.dispatch import receiver
from livekit.protocol.room import SendDataRequest

from .consumers import get_consultation
from .models import (
    Appointment,
    AppointmentStatus,
    Consultation,
    Message,
    Participant,
    Request,
    RequestStatus,
)
from .serializers import ConsultationSerializer
from .tasks import handle_invites


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


@receiver(post_save, sender=Message)
def message_saved(sender, instance: Message, created, **kwargs):
    """
    Whenever a Message is created, broadcast it over Channels.
    """
    channel_layer = get_channel_layer()

    # Send notifications to each user
    for user_pk in get_users_to_notification_consultation(instance.consultation):
        async_to_sync(channel_layer.group_send)(
            f"user_{user_pk}",
            {
                "type": "message",
                "consultation_id": instance.consultation.pk,
                "message_id": instance.pk,
                "consultation": ConsultationSerializer(instance.consultation).data,
                "state": "created" if created else "updated",
            },
        )


@receiver(post_save, sender=Appointment)
def appointment_saved(sender, instance: Message, created, **kwargs):
    """
    Whenever a Message is created, broadcast it over Channels.
    """
    channel_layer = get_channel_layer()

    # Send notifications to each user
    for user_pk in get_users_to_notification_consultation(instance.consultation):
        async_to_sync(channel_layer.group_send)(
            f"user_{user_pk}",
            {
                "type": "message",
                "consultation_id": instance.consultation.pk,
                "appointment_id": instance.pk,
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


@receiver(post_save, sender=Appointment)
def send_appointment_invites(sender, instance, created, **kwargs):
    """
    Prepare invite sending over celery task.
    """

    if instance.status in [AppointmentStatus.SCHEDULED, AppointmentStatus.CANCELLED]:
        handle_invites.delay(instance.pk)


@receiver(pre_save, sender=Message)
def mark_message_edited(sender, instance, **kwargs):
    if instance.pk:
        try:
            old = Message.objects.get(pk=instance.pk)
            if old.content != instance.content or old.attachment != instance.attachment:
                instance.is_edited = True
                instance.save()
        except Message.DoesNotExist:
            pass


@receiver(pre_save, sender=Appointment)
def appointment_previous_scheduled_at(sender, instance, **kwargs):
    if instance.pk:
        try:
            old = Appointment.objects.get(pk=instance.pk)
            if old.scheduled_at != instance.scheduled_at:
                instance.previous_scheduled_at = old.scheduled_at
                instance.save()
            else:
                instance.previous_scheduled_at
                instance.save()
        except Appointment.DoesNotExist:
            pass


@receiver(post_save, sender=Appointment)
def send_appointment_invites_update(sender, instance, **kwargs):
    if instance.previous_scheduled_at:
        handle_invites.delay(instance.pk)


@receiver(post_delete, sender=Participant)
def rekove_participant(sender, instance, **kwargs):
    pass
