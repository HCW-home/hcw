"""Signals that auto-provision keypairs for users and queues created after
encryption was enabled platform-wide.
"""

import logging

from constance import config
from django.db import connection
from django.db.models.signals import post_save
from django.dispatch import receiver

from consultations.models import Queue
from users.models import User

logger = logging.getLogger(__name__)


def _current_schema_name() -> str | None:
    schema_name = getattr(connection, "schema_name", None)
    if not schema_name or schema_name == "public":
        return None
    return schema_name


@receiver(post_save, sender=User)
def provision_user_keypair_on_create(sender, instance: User, created: bool, **kwargs):
    if not created:
        return
    if not config.encryption_enabled:
        return
    if not config.master_public_key:
        return
    if instance.public_key:
        return
    if not instance.is_active:
        return
    schema_name = _current_schema_name()
    if not schema_name:
        return

    from .tasks import provision_single_user

    try:
        provision_single_user.delay(instance.pk, schema_name)
    except Exception:
        logger.exception("Failed to enqueue keypair provisioning for user %s", instance.pk)


@receiver(post_save, sender=Queue)
def provision_queue_keypair_on_create(sender, instance: Queue, created: bool, **kwargs):
    if not created:
        return
    if not config.encryption_enabled:
        return
    if not config.master_public_key:
        return
    if instance.public_key:
        return
    schema_name = _current_schema_name()
    if not schema_name:
        return

    from .tasks import provision_single_queue

    try:
        provision_single_queue.delay(instance.pk, config.master_public_key, schema_name)
    except Exception:
        logger.exception("Failed to enqueue keypair provisioning for queue %s", instance.pk)
