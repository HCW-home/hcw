"""FHIR resource mappers for the consultations app."""
from __future__ import annotations

import warnings

from django.db.models import Q
from fhir.resources.R4B.appointment import Appointment as FhirAppointment
from fhir.resources.R4B.encounter import Encounter as FhirEncounter
from fhir.resources.R4B.medicationrequest import MedicationRequest as FhirMedicationRequest

from fhir_server.exceptions import FhirOperationError
from fhir_server.mappers import FhirResourceMapper
from fhir_server.references import (
    build_identifier,
    build_reference,
    get_external_identifier_system,
    parse_reference,
)
from fhir_server.search import (
    CallableParam,
    DateParam,
    IdentifierParam,
    RefParam,
    TokenParam,
    chained_params,
    with_chained,
)

from .models import (
    Appointment,
    AppointmentStatus,
    Consultation,
    Participant,
    Prescription,
    PrescriptionStatus,
    Type,
)

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


def _appointment_status_to_fhir(instance) -> str:
    """Derive the FHIR Appointment.status from HCW state + participant confirmations.

    Cancelled/draft map directly. A scheduled appointment reflects the
    confirmation state of its active participants (per FHIR semantics):
    - booked   : every active participant has confirmed (is_confirmed=True)
    - pending  : at least one has confirmed, but not all
    - proposed : none have confirmed (all None, or none accepted)
    """
    if instance.status == AppointmentStatus.cancelled.value:
        return "cancelled"
    if instance.status == AppointmentStatus.draft.value:
        return "proposed"

    confirmations = list(
        instance.participant_set.filter(is_active=True).values_list(
            "is_confirmed", flat=True
        )
    )
    if confirmations and all(c is True for c in confirmations):
        return "booked"
    if any(c is True for c in confirmations):
        return "pending"
    return "proposed"

_TYPE_SYSTEM = "http://terminology.hl7.org/CodeSystem/v2-0276"
_TYPE_TO_CODE = {Type.online.value: "ROUTINE", Type.inperson.value: "WALKIN"}
_CODE_TO_TYPE = {"ROUTINE": Type.online.value, "WALKIN": Type.inperson.value}


class AppointmentFhirMapper(FhirResourceMapper):
    resource_type = "Appointment"
    model = Appointment
    profile_urls = ["http://hl7.org/fhir/StructureDefinition/Appointment"]

    # Both patient and practitioner resolve to active participants, filtered by
    # role — matching what `to_fhir` serialises (`_map_participant_out` types
    # each participant Patient/Practitioner via `is_practitioner`). The chained
    # `.identifier` / `.name` params are derived from these by `with_chained`.
    search_params = with_chained({
        "patient": RefParam(
            field="participant__user",
            extra=Q(participant__is_active=True, participant__user__is_practitioner=False),
            chainable=True,
            target_resource_type="Patient",
            name_fields=["first_name", "last_name"],
        ),
        "practitioner": RefParam(
            field="participant__user",
            extra=Q(participant__is_active=True, participant__user__is_practitioner=True),
            chainable=True,
            target_resource_type="Practitioner",
            name_fields=["first_name", "last_name"],
        ),
        "date": DateParam(field="scheduled_at"),
        "status": TokenParam(field="status", mapping={v: k for k, v in _STATUS_TO_FHIR.items()}),
        "identifier": IdentifierParam(
            canonical_field="pk",
            external_field="external_id",
            resource_type="Appointment",
        ),
        "_lastUpdated": DateParam(field="updated_at"),
    })

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
        # Local imports mirror `_patient_mapper` (phase-2 cycle avoidance).
        from users.fhir import PatientFhirMapper, PractitionerFhirMapper
        mappers = {
            "patient": PatientFhirMapper(),
            "practitioner": PractitionerFhirMapper(),
        }
        contained: list[dict] = []
        seen: dict = {}            # user.pk -> fragment id (dedup)
        counters = {"patient": 0, "practitioner": 0}

        participants = [
            self._map_participant_out(
                p, contained=contained, seen=seen,
                counters=counters, mappers=mappers, context=context,
            )
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

        identifiers = [build_identifier("Appointment", instance.pk)]
        ext_sys = get_external_identifier_system("Appointment")
        if ext_sys and instance.external_id:
            identifiers.append({
                "use": "secondary",
                "system": ext_sys,
                "value": instance.external_id,
            })

        kwargs = dict(
            resourceType="Appointment",
            id=str(instance.pk),
            identifier=identifiers,
            status=_appointment_status_to_fhir(instance),
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
        if contained:
            body["contained"] = contained
        meta = self.build_meta(instance)
        if meta:
            body["meta"] = meta
        return body

    def _map_participant_out(
        self, participant: Participant, *,
        contained: list, seen: dict, counters: dict, mappers: dict, context=None,
    ) -> dict:
        user = participant.user
        if user is None:
            return {"status": "needs-action"}

        kind = "practitioner" if user.is_practitioner else "patient"
        frag = seen.get(user.pk)
        if frag is None:
            idx = counters[kind]
            frag = kind if idx == 0 else f"{kind}-{idx}"
            counters[kind] = idx + 1
            seen[user.pk] = frag
            # Embed the full Patient/Practitioner as a contained resource so the
            # `#fragment` reference below resolves within the same document.
            res = mappers[kind].to_fhir(user, context=context)
            res["id"] = frag
            res.pop("meta", None)
            contained.append(res)

        display = user.name if hasattr(user, "name") else (user.email or str(user.pk))
        return {
            "actor": {
                "reference": f"#{frag}",
                "display": display,
            },
            "status": "accepted" if participant.is_confirmed else (
                "declined" if participant.is_confirmed is False else "tentative"
            ),
        }

    # -- from_fhir ----------------------------------------------------------

    def from_fhir(self, payload: dict, instance=None, *, context=None):
        # FHIR R4 marks Appointment.participant as 1..* (Pydantic enforces it).
        # On partial updates (PUT to just change status etc.) callers commonly
        # omit it. When that happens AND we have an existing instance, inject
        # a placeholder to satisfy Pydantic and remember to skip the
        # participant-sync step in `post_save` (so existing participants stay
        # untouched instead of being soft-deactivated).
        participant_omitted = (
            instance is not None
            and isinstance(payload, dict)
            and "participant" not in payload
        )
        if participant_omitted:
            payload = {**payload, "participant": []}
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

        ext_sys = get_external_identifier_system("Appointment")
        if ext_sys:
            for ident in (parsed.identifier or []):
                if (
                    getattr(ident, "system", None) == ext_sys
                    and getattr(ident, "value", None)
                ):
                    instance.external_id = ident.value
                    break

        # When the caller omitted `participant` on a partial update we keep
        # the existing rows: leave the attribute unset so `post_save` skips.
        if not participant_omitted:
            instance._fhir_participants_pending = list(parsed.participant or [])
            # Contained resources (inline Patient/Practitioner) keyed by their
            # fragment id, so `post_save` can resolve `#patient` references.
            contained = {}
            for res in (parsed.contained or []):
                rid = getattr(res, "id", None)
                if rid:
                    contained[rid] = res
            instance._fhir_contained = contained
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

    @staticmethod
    def _participant_is_confirmed(status_value):
        return (
            True if status_value == "accepted"
            else False if status_value == "declined"
            else None
        )

    def _resolve_participant_user(self, entry, instance, context):
        """Resolve one FHIR participant entry to ``(user, is_confirmed)``.

        Supports three reference forms:
        - `#fragment` → an inline `contained` Patient/Practitioner resource.
        - `Patient/<pk>` / `Practitioner/<pk>` → an existing User by pk.
        Returns None when the entry carries no resolvable reference.
        """
        from users.models import User  # local import to avoid cycles
        from users.fhir import _GENDER_FROM_FHIR
        from .fhir_participants import (
            get_or_create_patient_user,
            resolve_practitioner_user,
        )

        actor = getattr(entry, "actor", None)
        ref = (getattr(actor, "reference", None) if actor else None) or ""
        is_confirmed = self._participant_is_confirmed(getattr(entry, "status", None))

        # -- contained resource (#fragment) --------------------------------
        if ref.startswith("#"):
            frag = ref[1:]
            res = (getattr(instance, "_fhir_contained", None) or {}).get(frag)
            if res is None:
                raise FhirOperationError(
                    f"Contained resource '#{frag}' referenced by a participant "
                    f"is missing from the `contained` array.",
                    code="not-found", status_code=404,
                )
            # fhir.resources 8.2.0 parses contained into concrete types; the
            # resource type is exposed via get_resource_type() / __resource_type__.
            rtype = (
                res.get_resource_type() if hasattr(res, "get_resource_type")
                else getattr(type(res), "__resource_type__", None)
            )
            email, phone = self._extract_contained_telecom(res)
            if rtype == "Patient":
                first, last = self._extract_contained_name(res)
                gender = _GENDER_FROM_FHIR.get(getattr(res, "gender", None) or "")
                user = get_or_create_patient_user(
                    email=email, phone=phone, first_name=first, last_name=last,
                    gender=gender or None, birth_date=getattr(res, "birthDate", None),
                    created_by=instance.created_by,
                )
                return user, is_confirmed
            if rtype == "Practitioner":
                return resolve_practitioner_user(email=email), is_confirmed
            raise FhirOperationError(
                f"Unsupported contained resource type '{rtype}' for a participant.",
                code="not-supported", status_code=422,
            )

        # -- existing reference (Patient/<pk>) -----------------------------
        _, ident = parse_reference(ref)
        if not ident:
            return None
        try:
            user_pk = int(ident)
        except (TypeError, ValueError):
            return None
        user = User.objects.filter(pk=user_pk).first()
        if user is None:
            raise FhirOperationError(
                f"Referenced user {user_pk} not found in this tenant.",
                code="not-found", status_code=404,
            )
        return user, is_confirmed

    @staticmethod
    def _extract_contained_telecom(res):
        email = phone = None
        for entry in (getattr(res, "telecom", None) or []):
            system = getattr(entry, "system", None)
            value = getattr(entry, "value", None)
            if not value:
                continue
            if system == "email" and email is None:
                email = value
            elif system in ("phone", "sms") and phone is None:
                phone = value
        return email, phone

    @staticmethod
    def _extract_contained_name(res):
        names = getattr(res, "name", None) or []
        if not names:
            return "", ""
        first = names[0]
        given = getattr(first, "given", None) or []
        family = getattr(first, "family", None) or ""
        return (given[0] if given else ""), family

    def post_save(self, instance, *, payload=None, context=None, created=False):
        pending = getattr(instance, "_fhir_participants_pending", None)
        if pending is None:
            return

        desired_user_ids = set()
        desired = []
        for entry in pending:
            resolved = self._resolve_participant_user(entry, instance, context)
            if resolved is None:
                continue
            user, is_confirmed = resolved
            desired_user_ids.add(user.pk)
            desired.append((user.pk, is_confirmed))

        existing = {p.user_id: p for p in instance.participant_set.all()}
        for user_pk, is_confirmed in desired:
            if user_pk in existing:
                part = existing[user_pk]
                part.is_active = True
                part.is_confirmed = is_confirmed
                part.save()
            else:
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
        if hasattr(instance, "_fhir_contained"):
            delattr(instance, "_fhir_contained")

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


# -- Encounter ---------------------------------------------------------------

# HL7 v3 ActCode class codes
_ENCOUNTER_CLASS_SYSTEM = "http://terminology.hl7.org/CodeSystem/v3-ActCode"
_ENCOUNTER_CLASS_VIRTUAL = {"system": _ENCOUNTER_CLASS_SYSTEM, "code": "VR", "display": "virtual"}
_ENCOUNTER_CLASS_AMBULATORY = {"system": _ENCOUNTER_CLASS_SYSTEM, "code": "AMB", "display": "ambulatory"}


def _encounter_status_filter(raw_value: str) -> Q:
    """Map FHIR Encounter.status search values to Consultation.closed_at filters."""
    values = {v.strip() for v in raw_value.split(",") if v.strip()}
    q = Q()
    if "finished" in values:
        q |= Q(closed_at__isnull=False)
    if "in-progress" in values or "planned" in values:
        q |= Q(closed_at__isnull=True)
    return q


class EncounterFhirMapper(FhirResourceMapper):
    """Map HCW `Consultation` to FHIR R4 `Encounter`."""

    resource_type = "Encounter"
    model = Consultation
    profile_urls = ["http://hl7.org/fhir/StructureDefinition/Encounter"]

    search_params = {
        **with_chained({
            "patient": RefParam(
                field="beneficiary", chainable=True,
                target_resource_type="Patient",
                name_fields=["first_name", "last_name"],
            ),
            "subject": RefParam(
                field="beneficiary", chainable=True,
                target_resource_type="Patient",
                name_fields=["first_name", "last_name"],
            ),
            "practitioner": RefParam(
                field="created_by", chainable=True,
                target_resource_type="Practitioner",
                name_fields=["first_name", "last_name"],
            ),
            "participant": RefParam(
                field="created_by", chainable=True,
                target_resource_type="Practitioner",
                name_fields=["first_name", "last_name"],
            ),
            "date": DateParam(field="created_at"),
            "identifier": IdentifierParam(
                canonical_field="pk",
                external_field="external_id",
                resource_type="Encounter",
            ),
            "_lastUpdated": DateParam(field="updated_at"),
            "status": CallableParam(build=lambda raw, mod: _encounter_status_filter(raw)),
        }),
        # Legacy non-conformant alias: find Encounters by the linked Appointment
        # id or external_id. Kept for backward compatibility. The conformant
        # `appointment.identifier` / `appointment.name` keys are added below.
        "appointment": IdentifierParam(
            canonical_field="appointments__pk",
            external_field="appointments__external_id",
            resource_type="Appointment",
        ),
        **chained_params(
            "appointment",
            RefParam(
                field="appointments", chainable=True,
                target_resource_type="Appointment",
                name_fields=["title"],
            ),
        ),
    }

    @property
    def include_targets(self):
        return {
            "patient": (self._patient_mapper, self._resolve_patient),
            "subject": (self._patient_mapper, self._resolve_patient),
            "practitioner": (self._practitioner_mapper, self._resolve_practitioners),
        }

    def _patient_mapper(self):
        try:
            from users.fhir import PatientFhirMapper
        except ImportError:
            return None
        return PatientFhirMapper()

    def _practitioner_mapper(self):
        try:
            from users.fhir import PractitionerFhirMapper
        except ImportError:
            return None
        return PractitionerFhirMapper()

    def _resolve_patient(self, instance):
        return [instance.beneficiary] if instance.beneficiary_id else []

    def _resolve_practitioners(self, instance):
        out = []
        if instance.created_by_id:
            out.append(instance.created_by)
        if instance.owned_by_id and instance.owned_by_id != instance.created_by_id:
            out.append(instance.owned_by)
        return out

    # -- to_fhir ------------------------------------------------------------

    def to_fhir(self, instance, *, context=None) -> dict:
        status = "finished" if instance.closed_at else "in-progress"

        # Derive Encounter.class from the linked Appointment (latest wins).
        klass = _ENCOUNTER_CLASS_VIRTUAL
        last_appt = instance.appointments.order_by("-scheduled_at").first()
        if last_appt and last_appt.type == Type.inperson.value:
            klass = _ENCOUNTER_CLASS_AMBULATORY

        participants = []
        if instance.created_by_id:
            participants.append({
                "individual": build_reference("Practitioner", instance.created_by_id),
                "type": [{
                    "coding": [{
                        "system": "http://terminology.hl7.org/CodeSystem/v3-ParticipationType",
                        "code": "PPRF",
                        "display": "primary performer",
                    }],
                }],
            })
        if instance.owned_by_id and instance.owned_by_id != instance.created_by_id:
            participants.append({
                "individual": build_reference("Practitioner", instance.owned_by_id),
                "type": [{
                    "coding": [{
                        "system": "http://terminology.hl7.org/CodeSystem/v3-ParticipationType",
                        "code": "ATND",
                        "display": "attender",
                    }],
                }],
            })

        period = {"start": instance.created_at}
        if instance.closed_at:
            period["end"] = instance.closed_at

        reason_codes = []
        request = getattr(instance, "request", None)
        if request and getattr(request, "reason_id", None):
            reason_codes.append({"text": request.reason.name})

        appointments = [
            build_reference("Appointment", appt.pk)
            for appt in instance.appointments.all()
        ]

        identifiers = [build_identifier("Encounter", instance.pk)]
        ext_sys = get_external_identifier_system("Encounter")
        if ext_sys and instance.external_id:
            identifiers.append({
                "use": "secondary",
                "system": ext_sys,
                "value": instance.external_id,
            })

        kwargs = dict(
            resourceType="Encounter",
            id=str(instance.pk),
            identifier=identifiers,
            status=status,
            **{"class": klass},
            period=period,
            participant=participants or None,
            appointment=appointments or None,
            reasonCode=reason_codes or None,
        )
        if instance.beneficiary_id:
            kwargs["subject"] = build_reference(
                "Patient", instance.beneficiary_id,
                display=instance.beneficiary.name if instance.beneficiary else None,
            )
        if instance.created_by_id and instance.created_by and instance.created_by.main_organisation_id:
            kwargs["serviceProvider"] = build_reference(
                "Organization", instance.created_by.main_organisation_id,
            )
        if instance.title or instance.description:
            kwargs["text"] = {
                "status": "generated",
                "div": f"<div xmlns='http://www.w3.org/1999/xhtml'>{instance.title or instance.description}</div>",
            }

        encounter = FhirEncounter(**{k: v for k, v in kwargs.items() if v is not None})
        body = encounter.model_dump(by_alias=True, exclude_none=True, mode="json")
        meta = self.build_meta(instance)
        if meta:
            body["meta"] = meta
        return body

    # -- from_fhir ----------------------------------------------------------

    def from_fhir(self, payload: dict, instance=None, *, context=None):
        parsed = FhirEncounter(**payload)
        request = (context or {}).get("request")
        user = getattr(request, "user", None)

        if instance is None:
            if user is None or not getattr(user, "is_authenticated", False):
                raise FhirOperationError(
                    "Authenticated user required to create an Encounter.",
                    code="forbidden", status_code=403,
                )
            instance = Consultation(created_by=user)

        # status → closed_at (finished → set now, in-progress → clear)
        if parsed.status == "finished":
            if instance.closed_at is None:
                from django.utils import timezone
                instance.closed_at = timezone.now()
        elif parsed.status == "in-progress":
            instance.closed_at = None

        # subject → beneficiary
        subject_ref = getattr(parsed.subject, "reference", None) if parsed.subject else None
        rtype, ident = parse_reference(subject_ref or "")
        if rtype == "Patient" and ident:
            from users.models import User as UserModel
            try:
                instance.beneficiary = UserModel.objects.get(pk=int(ident), is_practitioner=False)
            except (UserModel.DoesNotExist, ValueError):
                raise FhirOperationError(
                    f"Patient/{ident} not found in current tenant.",
                    code="not-found", status_code=404,
                )

        # period.end → closed_at when explicitly provided
        if parsed.period and getattr(parsed.period, "end", None):
            instance.closed_at = parsed.period.end

        # text → title fallback
        if not instance.title and payload.get("text", {}).get("div"):
            instance.title = payload["text"]["div"]

        ext_sys = get_external_identifier_system("Encounter")
        if ext_sys:
            for ident in (parsed.identifier or []):
                if (
                    getattr(ident, "system", None) == ext_sys
                    and getattr(ident, "value", None)
                ):
                    instance.external_id = ident.value
                    break

        return instance

    def soft_delete(self, instance, *, context=None):
        from django.utils import timezone
        if instance.closed_at is None:
            instance.closed_at = timezone.now()
            instance.save(update_fields=["closed_at", "updated_at"])


# -- MedicationRequest -------------------------------------------------------

_PRESCRIPTION_STATUS_TO_FHIR = {
    PrescriptionStatus.draft.value: "draft",
    PrescriptionStatus.prescribed.value: "active",
    PrescriptionStatus.dispensed.value: "completed",
    PrescriptionStatus.cancelled.value: "cancelled",
}
_PRESCRIPTION_STATUS_FROM_FHIR = {
    "draft": PrescriptionStatus.draft.value,
    "active": PrescriptionStatus.prescribed.value,
    "on-hold": PrescriptionStatus.draft.value,
    "completed": PrescriptionStatus.dispensed.value,
    "cancelled": PrescriptionStatus.cancelled.value,
    "stopped": PrescriptionStatus.cancelled.value,
    "entered-in-error": PrescriptionStatus.cancelled.value,
}


class PrescriptionFhirMapper(FhirResourceMapper):
    """Map HCW `Prescription` to FHIR R4 `MedicationRequest`."""

    resource_type = "MedicationRequest"
    model = Prescription
    profile_urls = ["http://hl7.org/fhir/StructureDefinition/MedicationRequest"]

    search_params = {
        "patient": RefParam(field="consultation__beneficiary"),
        "subject": RefParam(field="consultation__beneficiary"),
        "encounter": RefParam(field="consultation"),
        "requester": RefParam(field="created_by"),
        "status": TokenParam(
            field="status",
            mapping={v: k for k, v in _PRESCRIPTION_STATUS_TO_FHIR.items()},
        ),
        "authored": DateParam(field="created_at"),
        "identifier": IdentifierParam(
            canonical_field="pk",
            external_field="external_id",
            resource_type="MedicationRequest",
        ),
        "_lastUpdated": DateParam(field="updated_at"),
    }

    @property
    def include_targets(self):
        return {
            "patient": (self._patient_mapper, self._resolve_patient),
            "subject": (self._patient_mapper, self._resolve_patient),
            "requester": (self._practitioner_mapper, self._resolve_requester),
            "encounter": (EncounterFhirMapper, self._resolve_encounter),
        }

    def _patient_mapper(self):
        try:
            from users.fhir import PatientFhirMapper
        except ImportError:
            return None
        return PatientFhirMapper()

    def _practitioner_mapper(self):
        try:
            from users.fhir import PractitionerFhirMapper
        except ImportError:
            return None
        return PractitionerFhirMapper()

    def _resolve_patient(self, instance):
        consultation = instance.consultation
        if consultation and consultation.beneficiary_id:
            return [consultation.beneficiary]
        return []

    def _resolve_requester(self, instance):
        return [instance.created_by] if instance.created_by_id else []

    def _resolve_encounter(self, instance):
        return [instance.consultation] if instance.consultation_id else []

    # -- to_fhir ------------------------------------------------------------

    def to_fhir(self, instance, *, context=None) -> dict:
        consultation = instance.consultation
        subject = None
        if consultation and consultation.beneficiary_id:
            subject = build_reference(
                "Patient", consultation.beneficiary_id,
                display=consultation.beneficiary.name if consultation.beneficiary else None,
            )

        dosage_parts = [p for p in [
            instance.dosage,
            instance.frequency,
            f"for {instance.duration}" if instance.duration else None,
        ] if p]
        dosage_text = " ".join(dosage_parts).strip()
        if instance.instructions:
            dosage_text = (dosage_text + "\n" + instance.instructions).strip()

        dosage_instructions = []
        if dosage_text:
            dosage_instructions.append({"text": dosage_text})

        identifiers = [build_identifier("MedicationRequest", instance.pk)]
        ext_sys = get_external_identifier_system("MedicationRequest")
        if ext_sys and instance.external_id:
            identifiers.append({
                "use": "secondary",
                "system": ext_sys,
                "value": instance.external_id,
            })

        kwargs = dict(
            resourceType="MedicationRequest",
            id=str(instance.pk),
            identifier=identifiers,
            status=_PRESCRIPTION_STATUS_TO_FHIR.get(instance.status, "draft"),
            intent="order",
            medicationCodeableConcept={"text": instance.medication_name},
            authoredOn=(instance.prescribed_at or instance.created_at),
        )
        if subject:
            kwargs["subject"] = subject
        if instance.consultation_id:
            kwargs["encounter"] = build_reference("Encounter", instance.consultation_id)
        if instance.created_by_id:
            kwargs["requester"] = build_reference("Practitioner", instance.created_by_id)
        if dosage_instructions:
            kwargs["dosageInstruction"] = dosage_instructions
        if instance.notes:
            kwargs["note"] = [{"text": instance.notes}]

        mr = FhirMedicationRequest(**kwargs)
        body = mr.model_dump(by_alias=True, exclude_none=True, mode="json")
        meta = self.build_meta(instance)
        if meta:
            body["meta"] = meta
        return body

    # -- from_fhir ----------------------------------------------------------

    def from_fhir(self, payload: dict, instance=None, *, context=None):
        parsed = FhirMedicationRequest(**payload)
        request = (context or {}).get("request")
        user = getattr(request, "user", None)

        if instance is None:
            if user is None or not getattr(user, "is_authenticated", False):
                raise FhirOperationError(
                    "Authenticated user required to create a MedicationRequest.",
                    code="forbidden", status_code=403,
                )
            instance = Prescription(created_by=user)

        # medication
        med = parsed.medicationCodeableConcept
        med_name = getattr(med, "text", None) if med else None
        if not med_name and med and med.coding:
            med_name = med.coding[0].display or med.coding[0].code
        if not med_name:
            raise FhirOperationError(
                "MedicationRequest.medicationCodeableConcept.text is required.",
                code="required", status_code=400,
            )
        instance.medication_name = med_name

        # status
        if parsed.status:
            instance.status = _PRESCRIPTION_STATUS_FROM_FHIR.get(
                parsed.status, PrescriptionStatus.draft.value,
            )

        if parsed.authoredOn:
            instance.prescribed_at = parsed.authoredOn

        # encounter → consultation (required)
        enc_ref = getattr(parsed.encounter, "reference", None) if parsed.encounter else None
        rtype, ident = parse_reference(enc_ref or "")
        if rtype == "Encounter" and ident:
            try:
                instance.consultation = Consultation.objects.get(pk=int(ident))
            except (Consultation.DoesNotExist, ValueError):
                raise FhirOperationError(
                    f"Encounter/{ident} not found in current tenant.",
                    code="not-found", status_code=404,
                )
        elif instance.consultation_id is None:
            raise FhirOperationError(
                "MedicationRequest.encounter is required.",
                code="required", status_code=400,
            )

        # dosageInstruction → dosage free-text (single line, Phase 4 MVP)
        if parsed.dosageInstruction:
            text = parsed.dosageInstruction[0].text or ""
            if text:
                instance.dosage = text[:100]
                instance.instructions = text

        # requester override (admin use-case)
        req_ref = getattr(parsed.requester, "reference", None) if parsed.requester else None
        rtype, ident = parse_reference(req_ref or "")
        if rtype == "Practitioner" and ident:
            from users.models import User as UserModel
            try:
                instance.created_by = UserModel.objects.get(
                    pk=int(ident), is_practitioner=True,
                )
            except (UserModel.DoesNotExist, ValueError):
                raise FhirOperationError(
                    f"Practitioner/{ident} not found.",
                    code="not-found", status_code=404,
                )

        # notes
        if parsed.note:
            notes = "\n".join(n.text for n in parsed.note if n.text)
            instance.notes = notes

        ext_sys = get_external_identifier_system("MedicationRequest")
        if ext_sys:
            for ident in (parsed.identifier or []):
                if (
                    getattr(ident, "system", None) == ext_sys
                    and getattr(ident, "value", None)
                ):
                    instance.external_id = ident.value
                    break

        return instance

    def soft_delete(self, instance, *, context=None):
        instance.status = PrescriptionStatus.cancelled.value
        instance.save(update_fields=["status", "updated_at"])
