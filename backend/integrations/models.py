"""Idempotency ledger for Odoo syncs.

A sync handler can be invoked more than once for the same HCW object (Django
signals re-fire on retry, Celery redelivers). This table is the single source
of truth for "have we already pushed this, and was it the same payload?".

Design:
- One row per (hcw object, odoo model) pair.
- ``event_hash`` is a hash of the payload we last sent. If a later sync
  produces the same hash we skip the write entirely (no Odoo round-trip,
  no duplicate record).
- If the hash differs we UPDATE the existing Odoo record by id (never create
  a second one).

This keeps the sync both replay-safe and update-safe without scattering
"did we already create this?" checks across the sync code.
"""

from __future__ import annotations

import hashlib

from django.db import models


class OdooSyncState(models.Model):
    # The HCW-side object this row tracks. Using a generic relation would add
    # a dependency; a plain app_label+model+pk triple is simpler and enough.
    content_type = models.CharField(max_length=100)
    object_id = models.PositiveBigIntegerField()
    odoo_model = models.CharField(max_length=100)
    odoo_id = models.IntegerField(null=True)
    event_hash = models.CharField(max_length=64)
    last_synced_at = models.DateTimeField(auto_now=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=["content_type", "object_id", "odoo_model"],
                name="uniq_sync_target",
            )
        ]

    @classmethod
    def compute_hash(cls, payload: dict) -> str:
        # Stable, order-independent hash of the payload we intend to send.
        canonical = repr(sorted(payload.items()))
        return hashlib.sha256(canonical.encode("utf-8")).hexdigest()
