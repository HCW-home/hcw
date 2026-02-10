from asgiref.sync import async_to_sync
from channels.layers import get_channel_layer
from django.db.models.signals import post_save
from django.dispatch import receiver

from .models import Message, MessageStatus, Template
from .tasks import send_message
from django.db import transaction

@receiver(post_save, sender=Message)
def notify_message_recipient(sender, instance: Message, created, **kwargs):
    """
    Send websocket notification to the message recipient when a message is created
    """
    if created and instance.sent_to and instance.in_notification:
        channel_layer = get_channel_layer()
        async_to_sync(channel_layer.group_send)(
            f"user_{instance.sent_to.id}",
            {
                "type": "notification",
                "id": instance.id,
                "render_content_html": instance.render_content_html,
                "render_subject": instance.render_subject,
                "access_link": instance.access_link,
                "action_label": instance.action_label,
                "action": instance.action_label,
                "created_at": instance.created_at.isoformat() if instance.created_at else None,
            }
        )

        transaction.on_commit(lambda: send_message.delay(instance.pk))
