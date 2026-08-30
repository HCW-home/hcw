import logging
import random
import time
from datetime import timedelta

import requests as http_requests
from django.contrib.contenttypes.models import ContentType
from django.core.cache import caches
from django_tenants.utils import get_tenant_model, tenant_context

from constance import config
from django.db.models import F, Q
from django.utils import timezone
from core.celery import app

from .models import User

logger = logging.getLogger(__name__)

NOMINATIM_URL = "https://nominatim.openstreetmap.org/search"
NOMINATIM_HEADERS = {"User-Agent": "HCW-Home/1.0"}

# Nominatim's usage policy caps public use at one request per second and answers
# 429 beyond that. Bulk imports create one geocoding task per saved record, so
# the limit is reached easily: when it is, every geocoding task steps back at
# once instead of hammering on. The pause lives in the schema-agnostic cache
# because the quota belongs to our IP, not to a tenant.
NOMINATIM_RATE_LIMIT = "1/s"
NOMINATIM_COOLDOWN_KEY = "nominatim:cooldown_until"
NOMINATIM_COOLDOWN_SECONDS = 120
NOMINATIM_MAX_COOLDOWN_SECONDS = 1800
# Tasks must not all wake up on the same second, or the pause ends on a burst
# that earns a new 429 straight away.
NOMINATIM_WAKEUP_JITTER_SECONDS = 60
# Giving up loses nothing: `manage.py geocode` picks up every object still
# missing its location.
NOMINATIM_MAX_RETRIES = 24


def geocoding_pause_remaining():
    """Seconds left before geocoding may resume, 0 when it can run now."""
    until = caches["shared"].get(NOMINATIM_COOLDOWN_KEY)
    if not until:
        return 0
    return max(0, int(until - time.time()))


def pause_geocoding(retry_after=None):
    """Hold every geocoding task back, widening the pause on repeated 429s."""
    try:
        delay = max(int(retry_after), NOMINATIM_COOLDOWN_SECONDS)
    except (TypeError, ValueError):
        delay = max(NOMINATIM_COOLDOWN_SECONDS, geocoding_pause_remaining() * 2)
    delay = min(delay, NOMINATIM_MAX_COOLDOWN_SECONDS)

    caches["shared"].set(
        NOMINATIM_COOLDOWN_KEY, time.time() + delay, timeout=delay + 60
    )
    return delay


def _wakeup_delay(pause):
    return pause + random.uniform(0, NOMINATIM_WAKEUP_JITTER_SECONDS)


@app.task(
    bind=True,
    max_retries=NOMINATIM_MAX_RETRIES,
    default_retry_delay=60,
    rate_limit=NOMINATIM_RATE_LIMIT,
)
def geocode_location(self, app_label, model_name, object_id, schema_name):
    """Geocode an object's address fields using Nominatim (OpenStreetMap)."""
    # Checked first: while geocoding is paused, a task costs one rescheduling
    # and not a single query nor request.
    paused_for = geocoding_pause_remaining()
    if paused_for:
        logger.info(
            f"Geocoding paused for {paused_for}s, postponing "
            f"{app_label}.{model_name} pk={object_id}"
        )
        raise self.retry(countdown=_wakeup_delay(paused_for))

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
        except Exception as exc:
            logger.warning(f"Nominatim request failed for '{address}': {exc}")
            raise self.retry(exc=exc)

        if resp.status_code == 429:
            pause = pause_geocoding(resp.headers.get("Retry-After"))
            logger.warning(
                f"Nominatim answered 429, pausing every geocoding task for "
                f"{pause}s"
            )
            raise self.retry(countdown=_wakeup_delay(pause))

        try:
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

            from consultations.utils import appointment_active_q

            now = timezone.now()
            one_hour_ago = now - timedelta(hours=1)
            users = User.objects.filter(
                temporary=True,
                date_joined__lt=one_hour_ago
            ).exclude(
                appointment_active_q("appointments_participating")
                & Q(appointments_participating__status="scheduled"),
            ).exclude(
                # Keep users who still have an active reminder addressed to them
                # whose schedule isn't exhausted yet (recurrence_end_at is the
                # last occurrence; equals scheduled_at for non-recurring ones).
                reminders__is_active=True,
                reminders__recurrence_end_at__gte=now,
            ).exclude(
                Q(consultation__isnull=False) |
                Q(consultation_created__isnull=False) |
                Q(consultation_owned__isnull=False)
            )
            count, _ = users.delete()
            logger.info(f"Auto-deleted {count} temporary user(s) with no future appointments, no future reminders and no consultations")
