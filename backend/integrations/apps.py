"""Integration app: wires Odoo sync to HCW object lifecycle.

Design rule (thermonuclear #8): NO remote Odoo I/O happens in the request
path or inside a database transaction. The signal only ENQUEUES a durable
Celery task. The task performs the network writes and commits the
OdooSyncState row only after a successful Odoo round-trip. If the worker
crashes before that commit, no ledger row exists, so a retry re-runs the
sync cleanly — there is no half-applied state to recover.

Signal registration lives HERE, not in consultations/signals.py, so the
integration's trigger logic stays isolated from the consultation app's own
notification signals. One receiver, one concern: "schedule the sync".
"""

from __future__ import annotations

import logging

from django.apps import AppConfig
from django.db.models.signals import post_save
from django.dispatch import receiver


class IntegrationsConfig(AppConfig):
    default_auto_field = "django.db.models.BigAutoField"
    name = "integrations"
    label = "integrations"

    def ready(self) -> None:
        # Imported lazily to avoid AppConfig import cycles.
        from consultations.models import Consultation

        from .tasks import sync_consultation_to_odoo

        @receiver(post_save, sender=Consultation, dispatch_uid="odoo_sync_consultation")
        def _on_consultation_saved(sender, instance, created, **kwargs):
            # Auto-created/temporary consultations are HCW-internal scaffolding;
            # they must not create leads in Odoo. Only real, beneficiary-backed
            # consultations are handed off. The task re-checks this too.
            if getattr(instance, "temporary", False):
                return
            if not getattr(instance, "beneficiary", None):
                return
            # Enqueue only. Synchronous Odoo I/O here would hold the DB
            # transaction open across a network call (rule #8 blocker).
            try:
                sync_consultation_to_odoo.delay(instance.pk)
            except Exception:
                # If the broker is unavailable we must not crash the request;
                # the consultation is already saved. Log for the monitor to replay.
                logging.getLogger(__name__).exception(
                    "Failed to enqueue Odoo sync for consultation %s", instance.pk
                )
