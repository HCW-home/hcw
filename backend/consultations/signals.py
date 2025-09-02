from django.db.models.signals import post_save
from django.dispatch import receiver
from asgiref.sync import async_to_sync
from channels.layers import get_channel_layer
from .consumers import get_consultation
from .models import Consultation, Request, RequestStatus
from .serializers import ConsultationSerializer


@receiver(post_save, sender=Consultation)
def consultation_saved(sender, instance, created, **kwargs):
    """
    Whenever a Consultation is created/updated, broadcast it over Channels.
    """
    channel_layer = get_channel_layer()
    group_name = f"consultation_{instance.pk}"

    async_to_sync(channel_layer.group_send)(
        group_name,
        {
            "type": "consultation_update",
            "consultation_id": instance.pk,
        }
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
            logger.error(f"Failed to trigger celery task for request {instance.id}: {str(e)}")
            # For debugging: temporarily disable to see if this is the cause
            pass
