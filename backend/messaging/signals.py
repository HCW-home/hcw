from asgiref.sync import async_to_sync
from channels.layers import get_channel_layer
from django.db.models.signals import post_save
from django.dispatch import receiver

from .models import Message, MessageStatus, Template
from .tasks import create_template_validation


@receiver(post_save, sender=Template)
def template_validation(sender, instance: Template, created, **kwargs):
    create_template_validation.delay(instance.pk, created)


@receiver(post_save, sender=Message)
def queue_message_sending(sender, instance, created, **kwargs):
    """
    Automatically queue message for sending when a new message is created
    """
    if created and instance.status == MessageStatus.PENDING:
        print(f"BIN {instance}")
        # Import here to avoid circular imports
        from .tasks import send_message_via_provider

        # Queue the message for sending
        task = send_message_via_provider.delay(instance.id)

        # Update message with task ID (without triggering this signal again)
        Message.objects.filter(id=instance.id).update(celery_task_id=task.id)
