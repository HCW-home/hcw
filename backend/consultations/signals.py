from django.db.models.signals import post_save
from django.dispatch import receiver
from asgiref.sync import async_to_sync
from channels.layers import get_channel_layer
from .consumers import get_consultation
from .models import Consultation
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
