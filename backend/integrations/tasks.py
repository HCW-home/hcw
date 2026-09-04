"""Durable Celery task that performs the Odoo sync.

This is the ONLY place Odoo network I/O happens. It runs in a worker
process, outside the HTTP request and outside any database transaction
opened by the consultation save. The OdooSyncState ledger row is committed
only after a successful Odoo round-trip (see integrations.sync), so a crash
before that commit leaves no row and the broker retries the task cleanly.

HCW@Home is a django-tenants app: the task re-enters the consultation's
tenant schema before touching models, matching the project's existing
tenant-aware task pattern.
"""

from __future__ import annotations

import logging

from core.celery import app
from django_tenants.utils import get_tenant_model, tenant_context

from consultations.models import Consultation
from integrations.sync import sync_from_consultation

logger = logging.getLogger(__name__)


@app.task(bind=True, max_retries=5, default_retry_delay=30)
def sync_consultation_to_odoo(self, consultation_pk: int) -> None:
    Tenant = get_tenant_model()
    # Find the tenant that owns this consultation. HCW@Home uses one tenant
    # per organisation; we resolve it from the consultation's schema via the
    # connection's current tenant when the task was enqueued. If none is set
    # (worker started without one), fall back to the first tenant.
    from django.db import connection

    tenant = getattr(connection, "tenant", None)
    if tenant is None:
        tenant = Tenant.objects.first()
    if tenant is None:
        logger.error("No tenant available to sync consultation %s", consultation_pk)
        return

    with tenant_context(tenant):
        consultation = Consultation.objects.filter(pk=consultation_pk).first()
        if consultation is None:
            logger.warning("Consultation %s disappeared before sync", consultation_pk)
            return
        # Re-apply the same guard the signal used, so a manually-enqueued or
        # retried task never syncs scaffolding.
        if getattr(consultation, "temporary", False):
            return
        beneficiary = getattr(consultation, "beneficiary", None)
        if not beneficiary:
            return
        try:
            sync_from_consultation(consultation)
        except Exception as exc:
            logger.exception("Odoo sync failed for consultation %s", consultation_pk)
            raise self.retry(exc=exc)
