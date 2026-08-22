"""Odoo sync operations.

Every function is idempotent and side-effect-only-through-Odoo. The
OdooSyncState ledger is the single source of truth for "what did we already
send to Odoo for this HCW object", so a task retry or a signal re-fire can
never double-create.

Decision model (one per record type):
  1. Compute the desired payload + its hash.
  2. Look up the ledger row for (hcw object, odoo model).
  3. No row        -> resolve the Odoo id (match-or-create) and store it.
  4. Row, same hash -> nothing changed, return the stored id (no-op).
  5. Row, new hash -> update the stored Odoo id in place.

That is the whole branching. There is no other state to reason about.
"""

from __future__ import annotations

from typing import Any, Optional

from .models import OdooSyncState
from .odoo_client import OdooClient, config_from_env


def _content_type(obj: Any) -> str:
    return f"{obj._meta.app_label}.{obj._meta.model_name}"


def _patient_values(user) -> dict:
    name = (getattr(user, "get_full_name", None) and user.get_full_name()) or user.username
    return {
        "name": name,
        "email": user.email or False,
        "mobile": getattr(user, "phone", None) or False,
        "lang": "ar_SY" if getattr(user, "language", "en") == "ar" else "en_US",
        "customer_rank": 1,
    }


def _resolve_or_create_partner(client: OdooClient, values: dict, email: Optional[str]) -> int:
    """Return the Odoo partner id, matching on email when possible.

    Idempotent against Odoo itself: an existing partner with the same email
    is reused (and refreshed) instead of a duplicate being created.
    """
    if email:
        existing = client.search("res.partner", [["email", "=ilike", email]])
        if existing:
            partner_id = int(existing[0])
            client.write("res.partner", [partner_id], values)
            return partner_id
    return int(client.create("res.partner", values))


def _upsert(
    client: OdooClient,
    content_type: str,
    object_id: int,
    odoo_model: str,
    values: dict,
    *,
    resolve_odoo_id=None,
) -> Optional[int]:
    """Apply the single decision model above for one (hcw object, odoo model).

    ``resolve_odoo_id`` is called (with client + values) only when no ledger
    row exists yet; it returns the Odoo id to store. On a hash change for an
    already-stored id, we write the new values to that same id.
    """
    event_hash = OdooSyncState.compute_hash(values)
    state = OdooSyncState.objects.filter(
        content_type=content_type, object_id=object_id, odoo_model=odoo_model
    ).first()

    if state is None:
        odoo_id = resolve_odoo_id(client, values) if resolve_odoo_id else int(client.create(odoo_model, values))
        OdooSyncState.objects.create(
            content_type=content_type, object_id=object_id,
            odoo_model=odoo_model, odoo_id=odoo_id, event_hash=event_hash,
        )
        return odoo_id

    if state.event_hash == event_hash:
        return state.odoo_id  # nothing changed

    if state.odoo_id:
        client.write(odoo_model, [state.odoo_id], values)
        state.event_hash = event_hash
        state.save(update_fields=["event_hash", "last_synced_at"])
    return state.odoo_id


def sync_patient(client: OdooClient, user) -> Optional[int]:
    """Upsert the beneficiary as a res.partner. Returns the Odoo partner id."""
    values = _patient_values(user)
    return _upsert(
        client, "users.user", user.pk, "res.partner", values,
        resolve_odoo_id=lambda c, v: _resolve_or_create_partner(c, v, user.email),
    )


def sync_consultation(client: OdooClient, consultation, partner_id: Optional[int]) -> Optional[int]:
    """Create a crm.lead for the consultation (inbound/drill source).

    Deliberately NOT an appointment.booking.line: HCW@Home owns scheduling
    and the clinic Odoo is saas~19 (Appointments app). The lead is the
    durable handoff record; booking stays in HCW@Home.
    """
    values = {
        "name": f"Teleconsultation — {consultation.title or f'Consultation #{consultation.pk}'}",
        "description": consultation.description or "",
        "type": "lead",
        "x_source": "hcw_teleconsultation",
        "x_hcw_consultation_id": str(consultation.pk),
    }
    if partner_id:
        values["partner_id"] = partner_id
    return _upsert(client, _content_type(consultation), consultation.pk, "crm.lead", values)


def sync_from_consultation(consultation) -> None:
    """Top-level entry used by the Celery task.

    Resolves the beneficiary, syncs the partner, then the lead. Any Odoo
    failure propagates to the task, which retries. We never swallow errors
    into a silently-half-applied state.
    """
    client = OdooClient(config_from_env())
    beneficiary = getattr(consultation, "beneficiary", None)
    partner_id = sync_patient(client, beneficiary) if beneficiary else None
    sync_consultation(client, consultation, partner_id)
