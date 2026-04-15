import logging
from datetime import timedelta

import requests as http_requests
from django.contrib.contenttypes.models import ContentType
from django_tenants.utils import get_tenant_model, tenant_context

from constance import config
from django.db.models import F, Q
from django.utils import timezone
from core.celery import app

from .models import User

logger = logging.getLogger(__name__)

NOMINATIM_URL = "https://nominatim.openstreetmap.org/search"
NOMINATIM_HEADERS = {"User-Agent": "HCW-Home/1.0"}

@app.task(bind=True, max_retries=3, default_retry_delay=60)
def geocode_location(self, app_label, model_name, object_id, schema_name):
    """Geocode an object's address fields using Nominatim (OpenStreetMap)."""
    TenantModel = get_tenant_model()
    try:
        tenant = TenantModel.objects.get(schema_name=schema_name)
    except TenantModel.DoesNotExist:
        logger.error(f"Tenant with schema '{schema_name}' not found")
        return

    with tenant_context(tenant):
        ct = ContentType.objects.get(app_label=app_label, model=model_name)
        try:
            obj = ct.get_object_for_this_type(pk=object_id)
        except ct.model_class().DoesNotExist:
            logger.warning(f"{app_label}.{model_name} pk={object_id} not found")
            return

        parts = [obj.street, obj.postal_code, obj.city, obj.country]
        address = ", ".join(p.strip() for p in parts if p and p.strip())
        if not address:
            return

        try:
            resp = http_requests.get(
                NOMINATIM_URL,
                params={"q": address, "format": "json", "limit": 1},
                headers=NOMINATIM_HEADERS,
                timeout=10,
            )
            resp.raise_for_status()
            results = resp.json()
        except Exception as exc:
            logger.warning(f"Nominatim request failed for '{address}': {exc}")
            raise self.retry(exc=exc)

        if not results:
            logger.info(f"No geocoding result for '{address}'")
            return

        lat = results[0]["lat"]
        lon = results[0]["lon"]
        obj.location = f"{lat},{lon}"
        obj.save(update_fields=["location"])
        logger.info(f"Geocoded {app_label}.{model_name} pk={object_id}: {lat},{lon}")


@app.task
def auto_delete_temporary_users():
    TenantModel = get_tenant_model()
    for tenant in TenantModel.objects.exclude(schema_name='public'):
        with tenant_context(tenant):
            if not config.temporary_user_auto_delete:
                logger.info("Auto-delete of temporary users is disabled")
                return

            two_hours_ago = timezone.now() - timedelta(hours=2)
            one_hour_ago = timezone.now() - timedelta(hours=1)
            users = User.objects.filter(
                temporary=True,
                date_joined__lt=one_hour_ago
            ).exclude(
                appointments_participating__status="scheduled",
                appointments_participating__scheduled_at__gt=two_hours_ago,
            ).exclude(
                Q(consultation__isnull=False) |
                Q(consultation_created__isnull=False) |
                Q(consultation_owned__isnull=False)
            )
            count, _ = users.delete()
            logger.info(f"Auto-deleted {count} temporary user(s) with no future appointments and no consultations")
