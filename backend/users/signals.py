from django.db import connection
from django.db.models.signals import post_save
from django.dispatch import receiver

from .models import User, Organisation

ADDRESS_FIELDS = frozenset({"street", "city", "postal_code", "country"})


@receiver(post_save, sender=User)
@receiver(post_save, sender=Organisation)
def trigger_geocoding(sender, instance, **kwargs):
    """Trigger async geocoding when address fields change and city is set."""
    if not instance.city:
        return

    update_fields = kwargs.get("update_fields")
    if update_fields is not None:
        update_fields = set(update_fields)
        # Skip if only location was updated (avoids infinite loop)
        if update_fields == {"location"}:
            return
        # Skip if no address field was touched
        if not ADDRESS_FIELDS.intersection(update_fields):
            return

    from .tasks import geocode_location

    geocode_location.delay(
        sender._meta.app_label,
        sender._meta.model_name,
        instance.pk,
        connection.tenant.schema_name,
    )
