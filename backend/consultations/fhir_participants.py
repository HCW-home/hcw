"""Resolve Appointment participants from FHIR `contained` resources.

A FHIR client may inline Patient/Practitioner resources in the Appointment's
`contained` array and reference them internally (`#patient`). These helpers
turn such a contained resource into an HCW `User`, mirroring the native
temporary-participant creation in `AppointmentCreateSerializer` (find-or-create
by email/phone, `temporary=True`).

Policy:
- Patients are created on the fly (find-or-create).
- Practitioners are NEVER created via FHIR — looked up by email, error if absent.
"""
from __future__ import annotations

from messaging.models import CommunicationMethod
from users.models import User

from fhir_server.exceptions import FhirOperationError


def get_or_create_patient_user(
    *, email=None, phone=None, first_name="", last_name="",
    gender=None, birth_date=None, created_by=None,
):
    """Find-or-create a patient User (``is_practitioner=False``).

    Match order: email first (unique), then phone, else create an anonymous
    temporary contact. `defaults` are applied only on creation, so an existing
    matched user is never mutated — matching the native serializer's behaviour.
    """
    defaults = {
        "first_name": first_name or "",
        "last_name": last_name or "",
        "communication_method": CommunicationMethod.email,
        "temporary": True,
        "created_by": created_by,
        "is_practitioner": False,
    }
    if gender:
        defaults["gender"] = gender
    if birth_date:
        defaults["date_of_birth"] = birth_date

    if email:
        user, _ = User.objects.get_or_create(email=email, defaults=defaults)
    elif phone:
        user, _ = User.objects.get_or_create(
            mobile_phone_number=phone, defaults=defaults,
        )
    else:
        # Anonymous contact: no lookup key (mirrors the native "manual contact").
        user = User.objects.create(**defaults)
    return user


def resolve_practitioner_user(*, email):
    """Look up a practitioner User by email. Never creates one.

    Raises FhirOperationError(422) when absent — encodes the business rule that
    practitioners are not provisioned through FHIR.
    """
    if email:
        user = User.objects.filter(email=email, is_practitioner=True).first()
        if user is not None:
            return user
    raise FhirOperationError(
        f"Practitioner with email '{email}' not found; practitioners are not "
        f"created via FHIR.",
        code="business-rule",
        status_code=422,
    )
