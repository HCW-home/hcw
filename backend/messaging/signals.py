from django.db.models.signals import post_save
from django.dispatch import receiver
from asgiref.sync import async_to_sync
from channels.layers import get_channel_layer
from .models import Template
from .tasks import create_template_validation

@receiver(post_save, sender=Template)
def template_validation(sender, instance: Template, created, **kwargs):
    create_template_validation.delay(instance.pk, created)