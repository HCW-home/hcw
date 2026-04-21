"""FHIR Patient and Practitioner mappers.

Both resources share most of the `User` model mapping (name, telecom, address,
gender, birthDate, photo, communication). The `is_practitioner` flag discriminates
the two resources and forces scope on create/update.
"""
from __future__ import annotations

from django.db.models import Q
from fhir.resources.R4B.patient import Patient as FhirPatient
from fhir.resources.R4B.practitioner import Practitioner as FhirPractitioner

from fhir_server.exceptions import FhirOperationError
from fhir_server.mappers import FhirResourceMapper
from fhir_server.references import build_identifier, build_reference, parse_reference
from fhir_server.search import DateParam, RefParam, StringParam, TokenParam

from .models import Gender, Language, Organisation, Speciality, User


_GENDER_TO_FHIR = {
    Gender.male.value: "male",
    Gender.female.value: "female",
    Gender.other.value: "other",
    Gender.unknown.value: "unknown",
}
_GENDER_FROM_FHIR = {v: k for k, v in _GENDER_TO_FHIR.items()}


def _build_address(instance) -> list[dict]:
    has_address = any([
        instance.street, instance.city, instance.postal_code, instance.country,
    ])
    if not has_address:
        return []
    addr: dict = {"use": "home"}
    if instance.street:
        addr["line"] = [instance.street]
    if instance.city:
        addr["city"] = instance.city
    if instance.postal_code:
        addr["postalCode"] = instance.postal_code
    if instance.country:
        addr["country"] = instance.country
    return [addr]


def _apply_address(instance, address_list) -> None:
    if not address_list:
        return
    first = address_list[0]
    lines = getattr(first, "line", None) or []
    instance.street = lines[0] if lines else instance.street
    if getattr(first, "city", None):
        instance.city = first.city
    if getattr(first, "postalCode", None):
        instance.postal_code = first.postalCode
    if getattr(first, "country", None):
        instance.country = first.country


def _build_telecom(instance) -> list[dict]:
    telecom = []
    if instance.email:
        telecom.append({"system": "email", "value": instance.email, "use": "home"})
    if instance.mobile_phone_number:
        telecom.append({"system": "phone", "value": instance.mobile_phone_number, "use": "mobile"})
    return telecom


def _apply_telecom(instance, telecom_list) -> None:
    for entry in telecom_list or []:
        system = getattr(entry, "system", None)
        value = getattr(entry, "value", None)
        if not value:
            continue
        if system == "email":
            instance.email = value
        elif system == "phone" or system == "sms":
            instance.mobile_phone_number = value


def _build_names(instance) -> list[dict]:
    if not (instance.first_name or instance.last_name):
        return []
    name: dict = {"use": "official"}
    if instance.last_name:
        name["family"] = instance.last_name
    if instance.first_name:
        name["given"] = [instance.first_name]
    full = f"{instance.first_name} {instance.last_name}".strip()
    if full:
        name["text"] = full
    return [name]


def _apply_names(instance, name_list) -> None:
    if not name_list:
        return
    first = name_list[0]
    given = getattr(first, "given", None) or []
    family = getattr(first, "family", None)
    if given:
        instance.first_name = given[0]
    if family:
        instance.last_name = family


def _build_photo(instance, request) -> list[dict]:
    if not instance.picture:
        return []
    try:
        url = instance.picture.url
    except Exception:
        return []
    if request is not None and url.startswith("/"):
        url = request.build_absolute_uri(url)
    return [{"url": url, "contentType": "image/*"}]


def _build_communication(instance) -> list[dict]:
    langs = []
    for lang in instance.languages.all():
        langs.append({
            "language": {
                "coding": [{"system": "urn:ietf:bcp:47", "code": lang.code, "display": lang.name}],
                "text": lang.name,
            },
            "preferred": instance.preferred_language == lang.code,
        })
    return langs


def _apply_communication(instance, comm_list, *, post_save_callbacks: list) -> None:
    if comm_list is None:
        return
    codes = []
    preferred = None
    for entry in comm_list:
        coding = getattr(getattr(entry, "language", None), "coding", None) or []
        if not coding:
            continue
        code = coding[0].code
        if not code:
            continue
        codes.append(code)
        if getattr(entry, "preferred", False):
            preferred = code
    if preferred:
        instance.preferred_language = preferred

    def _reconcile():
        instance.languages.set(list(Language.objects.filter(code__in=codes)))

    post_save_callbacks.append(_reconcile)


class _BaseUserFhirMapper(FhirResourceMapper):
    """Shared logic between PatientFhirMapper and PractitionerFhirMapper."""

    fhir_resource_cls = None  # set by subclass
    is_practitioner_value: bool = False

    def build_identifiers(self, instance) -> list[dict]:
        identifiers = [build_identifier(self.resource_type, instance.pk)]
        if instance.email:
            identifiers.append({
                "system": "mailto",
                "value": instance.email,
                "use": "secondary",
            })
        return identifiers

    def _base_payload(self, instance, *, context=None) -> dict:
        request = (context or {}).get("request")
        body = {
            "resourceType": self.resource_type,
            "id": str(instance.pk),
            "identifier": self.build_identifiers(instance),
            "active": instance.is_active,
            "name": _build_names(instance),
            "telecom": _build_telecom(instance),
            "gender": _GENDER_TO_FHIR.get(instance.gender, "unknown"),
            "address": _build_address(instance),
            "photo": _build_photo(instance, request),
            "communication": _build_communication(instance),
        }
        if instance.date_of_birth:
            body["birthDate"] = instance.date_of_birth.isoformat()
        # Prune empty optional collections to satisfy Pydantic cardinality.
        for key in ("name", "telecom", "address", "photo", "communication"):
            if not body[key]:
                body.pop(key)
        return body

    def to_fhir(self, instance, *, context=None) -> dict:
        body = self._base_payload(instance, context=context)
        if instance.main_organisation_id:
            body["managingOrganization"] = build_reference(
                "Organization", instance.main_organisation_id
            )
        parsed = self.fhir_resource_cls(**body)
        output = parsed.model_dump(by_alias=True, exclude_none=True, mode="json")
        meta = self.build_meta(instance)
        if meta:
            output["meta"] = meta
        return output

    def from_fhir(self, payload: dict, instance=None, *, context=None):
        parsed = self.fhir_resource_cls(**payload)
        request = (context or {}).get("request")
        caller = getattr(request, "user", None)

        if instance is None:
            instance = self._resolve_upsert_target(parsed)

        if instance is None:
            instance = User(
                is_practitioner=self.is_practitioner_value,
                created_by=caller if getattr(caller, "is_authenticated", False) else None,
            )
        else:
            instance.is_practitioner = self.is_practitioner_value

        _apply_names(instance, parsed.name)
        _apply_telecom(instance, parsed.telecom)
        _apply_address(instance, parsed.address)
        if parsed.gender:
            instance.gender = _GENDER_FROM_FHIR.get(parsed.gender, Gender.unknown.value)
        if parsed.birthDate:
            instance.date_of_birth = parsed.birthDate
        if parsed.active is not None:
            instance.is_active = parsed.active

        main_org = self._resolve_managing_organization(parsed)
        if main_org is not None:
            instance.main_organisation = main_org

        # Anonymous patients without contact info need the temporary flow.
        if instance.pk is None and not self.is_practitioner_value:
            if not instance.email and not instance.mobile_phone_number:
                instance.temporary = True

        callbacks: list = []
        _apply_communication(instance, parsed.communication, post_save_callbacks=callbacks)
        instance._fhir_post_save = callbacks
        return instance

    def _resolve_upsert_target(self, parsed):
        """Look up an existing User from the identifier list (FHIR upsert)."""
        identifiers = parsed.identifier or []
        for ident in identifiers:
            system = getattr(ident, "system", None)
            value = getattr(ident, "value", None)
            if not value:
                continue
            if system == build_identifier(self.resource_type, 0)["system"]:
                try:
                    return User.objects.get(pk=int(value), is_practitioner=self.is_practitioner_value)
                except (User.DoesNotExist, ValueError):
                    return None
        return None

    def _resolve_managing_organization(self, parsed):
        ref = getattr(parsed, "managingOrganization", None)
        ref_str = getattr(ref, "reference", None) if ref else None
        rtype, ident = parse_reference(ref_str or "")
        if rtype != "Organization" or not ident:
            return None
        try:
            return Organisation.objects.get(pk=int(ident))
        except (Organisation.DoesNotExist, ValueError):
            raise FhirOperationError(
                f"Organization/{ident} not found in current tenant.",
                code="not-found", status_code=404,
            )

    def post_save(self, instance, *, payload=None, context=None, created=False):
        for callback in getattr(instance, "_fhir_post_save", []) or []:
            callback()
        if hasattr(instance, "_fhir_post_save"):
            delattr(instance, "_fhir_post_save")

    def soft_delete(self, instance, *, context=None):
        instance.is_active = False
        instance.save(update_fields=["is_active", "updated_at"])


# -- Patient -----------------------------------------------------------------

class PatientFhirMapper(_BaseUserFhirMapper):
    resource_type = "Patient"
    model = User
    is_practitioner_value = False
    fhir_resource_cls = FhirPatient
    profile_urls = ["http://hl7.org/fhir/StructureDefinition/Patient"]

    search_params = {
        "name": StringParam(fields=["first_name", "last_name"]),
        "family": StringParam(field="last_name"),
        "given": StringParam(field="first_name"),
        "identifier": TokenParam(field="pk"),
        "email": TokenParam(field="email"),
        "phone": TokenParam(field="mobile_phone_number"),
        "birthdate": DateParam(field="date_of_birth"),
        "gender": TokenParam(field="gender"),
        "address-city": StringParam(field="city"),
        "active": TokenParam(field="is_active"),
        "_lastUpdated": DateParam(field="updated_at"),
    }

    def to_fhir(self, instance, *, context=None) -> dict:
        output = super().to_fhir(instance, context=context)
        return output


# -- Practitioner ------------------------------------------------------------

class PractitionerFhirMapper(_BaseUserFhirMapper):
    resource_type = "Practitioner"
    model = User
    is_practitioner_value = True
    fhir_resource_cls = FhirPractitioner
    profile_urls = ["http://hl7.org/fhir/StructureDefinition/Practitioner"]

    search_params = {
        "name": StringParam(fields=["first_name", "last_name"]),
        "family": StringParam(field="last_name"),
        "given": StringParam(field="first_name"),
        "identifier": TokenParam(field="pk"),
        "email": TokenParam(field="email"),
        "phone": TokenParam(field="mobile_phone_number"),
        "active": TokenParam(field="is_active"),
        "specialty": RefParam(field="specialities"),
        "_lastUpdated": DateParam(field="updated_at"),
    }

    def to_fhir(self, instance, *, context=None) -> dict:
        body = self._base_payload(instance, context=context)
        qualification = []
        for spec in instance.specialities.all():
            qualification.append({
                "code": {
                    "coding": [{"system": "urn:oid:local-speciality", "code": str(spec.pk), "display": spec.name}],
                    "text": spec.name,
                }
            })
        if qualification:
            body["qualification"] = qualification

        parsed = self.fhir_resource_cls(**body)
        output = parsed.model_dump(by_alias=True, exclude_none=True, mode="json")
        meta = self.build_meta(instance)
        if meta:
            output["meta"] = meta
        return output

    def from_fhir(self, payload: dict, instance=None, *, context=None):
        instance = super().from_fhir(payload, instance=instance, context=context)
        parsed = self.fhir_resource_cls(**payload)
        # Reconcile specialties post-save using IDs extracted from qualification.code.coding[0].code
        speciality_ids = []
        for entry in parsed.qualification or []:
            coding = getattr(getattr(entry, "code", None), "coding", None) or []
            if not coding:
                continue
            code = coding[0].code
            if code and code.isdigit():
                speciality_ids.append(int(code))
        if speciality_ids:
            callbacks = getattr(instance, "_fhir_post_save", None) or []
            def _reconcile_specialities():
                instance.specialities.set(
                    list(Speciality.objects.filter(pk__in=speciality_ids))
                )
            callbacks.append(_reconcile_specialities)
            instance._fhir_post_save = callbacks
        return instance
