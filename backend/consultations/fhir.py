"""FHIR resource mappers for the consultations app."""
from __future__ import annotations

import warnings

from django.db.models import Q
from fhir.resources.appointment import Appointment as FhirAppointment

from fhir_server.exceptions import FhirOperationError
from fhir_server.mappers import FhirResourceMapper
from fhir_server.references import (
    build_identifier,
    build_reference,
    parse_reference,
)
from fhir_server.search import DateParam, RefParam, TokenParam

from .models import Appointment, AppointmentStatus, Consultation, Participant, Type

# HCW status <-> FHIR Appointment.status (using string values, not enum members)
_STATUS_TO_FHIR = {
    AppointmentStatus.draft.value: "pending",
    AppointmentStatus.scheduled.value: "booked",
    AppointmentStatus.cancelled.value: "cancelled",
}
_STATUS_FROM_FHIR = {
    "pending": AppointmentStatus.draft.value,
    "proposed": AppointmentStatus.draft.value,
    "booked": AppointmentStatus.scheduled.value,
    "arrived": AppointmentStatus.scheduled.value,
    "fulfilled": AppointmentStatus.scheduled.value,
    "cancelled": AppointmentStatus.cancelled.value,
    "noshow": AppointmentStatus.cancelled.value,
    "entered-in-error": AppointmentStatus.cancelled.value,
}

_TYPE_SYSTEM = "http://terminology.hl7.org/CodeSystem/v2-0276"
_TYPE_TO_CODE = {Type.online.value: "ROUTINE", Type.inperson.value: "WALKIN"}
_CODE_TO_TYPE = {"ROUTINE": Type.online.value, "WALKIN": Type.inperson.value}


class AppointmentFhirMapper(FhirResourceMapper):
    resource_type = "Appointment"
    model = Appointment
    profile_urls = ["http://hl7.org/fhir/StructureDefinition/Appointment"]

    search_params = {
        "patient": RefParam(field="participant__user", extra=Q(participant__is_active=True)),
        "practitioner": RefParam(field="created_by"),
        "date": DateParam(field="scheduled_at"),
        "status": TokenParam(field="status", mapping={v: k for k, v in _STATUS_TO_FHIR.items()}),
        "identifier": TokenParam(field="id"),
        "_lastUpdated": DateParam(field="updated_at"),
    }

    @property
    def include_targets(self):
        return {"patient": (self._patient_mapper, self._resolve_patients)}

    def _patient_mapper(self):
        try:
            from users.fhir import PatientFhirMapper  # phase 2
        except ImportError:
            return None
        return PatientFhirMapper()

    def _resolve_patients(self, instance):
        return [
            p.user for p in instance.participant_set.filter(is_active=True)
            if p.user and not p.user.is_practitioner
        ]

    # -- to_fhir ------------------------------------------------------------

    def to_fhir(self, instance, *, context=None) -> dict:
        participants = [
            self._map_participant_out(p)
            for p in instance.participant_set.all().select_related("user")
        ]
        appt_type_code = _TYPE_TO_CODE.get(instance.type)
        appointment_type = None
        if appt_type_code:
            appointment_type = {
                "coding": [{
                    "system": _TYPE_SYSTEM,
                    "code": appt_type_code,
                    "display": instance.get_type_display(),
                }]
            }

        description = None
        supporting_info = []
        if instance.consultation_id and instance.consultation:
            description = instance.consultation.description or instance.consultation.title
            enc_ref = build_reference("Encounter", instance.consultation_id)
            if enc_ref:
                supporting_info.append(enc_ref)

        kwargs = dict(
            resourceType="Appointment",
            id=str(instance.pk),
            identifier=[build_identifier("Appointment", instance.pk)],
            status=_STATUS_TO_FHIR.get(instance.status, "pending"),
            start=instance.scheduled_at,
            end=instance.end_expected_at,
            created=instance.created_at,
            participant=participants,
        )
        if instance.title:
            kwargs["description"] = instance.title
        elif description:
            kwargs["description"] = description
        if appointment_type:
            kwargs["appointmentType"] = appointment_type
        if supporting_info:
            kwargs["supportingInformation"] = supporting_info

        appt = FhirAppointment(**kwargs)
        body = appt.model_dump(by_alias=True, exclude_none=True, mode="json")
        meta = self.build_meta(instance)
        if meta:
            body["meta"] = meta
        return body

    def _map_participant_out(self, participant: Participant) -> dict:
        user = participant.user
        if user is None:
            return {"status": "needs-action"}
        resource_type = "Practitioner" if user.is_practitioner else "Patient"
        display = user.name if hasattr(user, "name") else (user.email or str(user.pk))
        return {
            "actor": {
                "reference": f"{resource_type}/{user.pk}",
                "display": display,
            },
            "status": "accepted" if participant.is_confirmed else (
                "declined" if participant.is_confirmed is False else "tentative"
            ),
        }

    # -- from_fhir ----------------------------------------------------------

    def from_fhir(self, payload: dict, instance=None, *, context=None):
        # Validate via Pydantic; handler turns errors into OperationOutcome.
        parsed = FhirAppointment(**payload)
        request = (context or {}).get("request")
        user = getattr(request, "user", None)

        if instance is None:
            if user is None or not getattr(user, "is_authenticated", False):
                raise FhirOperationError(
                    "Authenticated user required to create an Appointment.",
                    code="forbidden", status_code=403,
                )
            instance = Appointment(created_by=user)

        if parsed.status:
            instance.status = _STATUS_FROM_FHIR.get(parsed.status, AppointmentStatus.draft)
        if parsed.start:
            instance.scheduled_at = parsed.start
        if parsed.end:
            instance.end_expected_at = parsed.end
        if parsed.description:
            instance.title = parsed.description

        if parsed.appointmentType and parsed.appointmentType.coding:
            code = parsed.appointmentType.coding[0].code
            instance.type = _CODE_TO_TYPE.get(code, instance.type or Type.online)

        instance.consultation = self._resolve_encounter_reference(parsed)

        instance._fhir_participants_pending = list(parsed.participant or [])
        return instance

    def _resolve_encounter_reference(self, parsed):
        for ref in (parsed.supportingInformation or []):
            rtype, ident = parse_reference(getattr(ref, "reference", "") or "")
            if rtype == "Encounter" and ident:
                try:
                    return Consultation.objects.get(pk=int(ident))
                except (Consultation.DoesNotExist, ValueError):
                    raise FhirOperationError(
                        f"Referenced Encounter/{ident} not found.",
                        code="not-found", status_code=404,
                    )
        return None

    # -- lifecycle hooks (called by FhirViewSetMixin) -----------------------

    def post_save(self, instance, *, payload=None, context=None, created=False):
        pending = getattr(instance, "_fhir_participants_pending", None)
        if pending is None:
            return

        from users.models import User  # local import to avoid cycles

        desired_user_ids = set()
        desired = []
        for entry in pending:
            actor = getattr(entry, "actor", None)
            ref = getattr(actor, "reference", None) if actor else None
            rtype, ident = parse_reference(ref or "")
            if not ident:
                continue
            try:
                user_pk = int(ident)
            except (TypeError, ValueError):
                continue
            status_value = getattr(entry, "status", None)
            is_confirmed = (
                True if status_value == "accepted"
                else False if status_value == "declined"
                else None
            )
            desired_user_ids.add(user_pk)
            desired.append((user_pk, is_confirmed))

        existing = {p.user_id: p for p in instance.participant_set.all()}
        for user_pk, is_confirmed in desired:
            if user_pk in existing:
                part = existing[user_pk]
                part.is_active = True
                part.is_confirmed = is_confirmed
                part.save()
            else:
                if not User.objects.filter(pk=user_pk).exists():
                    raise FhirOperationError(
                        f"Referenced user {user_pk} not found in this tenant.",
                        code="not-found", status_code=404,
                    )
                Participant.objects.create(
                    appointment=instance,
                    user_id=user_pk,
                    is_confirmed=is_confirmed,
                    is_active=True,
                    is_invited=True,
                )
        # Deactivate participants not in the new set (soft remove)
        for user_pk, part in existing.items():
            if user_pk not in desired_user_ids:
                if part.is_active:
                    part.is_active = False
                    part.save(update_fields=["is_active"])

        delattr(instance, "_fhir_participants_pending")

    def soft_delete(self, instance, *, context=None):
        instance.status = AppointmentStatus.cancelled
        instance.save(update_fields=["status", "updated_at"])


class AppointmentFhir:
    """Deprecated adapter preserving the old `AppointmentFhir(data).to_fhir()` shape.

    The old renderer fed it a serializer dict; new code uses
    `AppointmentFhirMapper` directly on a model instance.
    """

    def __init__(self, data):
        warnings.warn(
            "AppointmentFhir is deprecated; use AppointmentFhirMapper.",
            DeprecationWarning,
            stacklevel=2,
        )
        self.data = data

    def to_fhir(self):
        if isinstance(self.data, Appointment):
            return AppointmentFhirMapper().to_fhir(self.data)
        # Legacy path: receive a serialized dict, try to locate the instance.
        pk = self.data.get("id") if isinstance(self.data, dict) else None
        if pk is not None:
            try:
                instance = Appointment.objects.get(pk=pk)
                return AppointmentFhirMapper().to_fhir(instance)
            except Appointment.DoesNotExist:
                pass
        return dict(self.data) if isinstance(self.data, dict) else {}
