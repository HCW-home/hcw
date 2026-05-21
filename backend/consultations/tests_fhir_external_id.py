"""Tests for FHIR `external_id` round-trip and conditional operations.

Covers:
- POST FHIR Appointment storing `external_id` from the inbound identifier array.
- Conditional GET / PUT / DELETE by `?identifier=system|value`.
- Encounter lookup via the linked Appointment's external_id.
- The `external_id` column remains invisible to the native DRF serializers.
"""
import json
from datetime import timedelta

from constance import config as constance_config
from django.urls import reverse
from django.utils import timezone
from django_tenants.test.cases import TenantTestCase
from rest_framework.test import APIClient

from consultations.models import (
    Appointment,
    AppointmentStatus,
    Consultation,
    Participant,
    Prescription,
    PrescriptionStatus,
)
from fhir_server.references import get_identifier_system
from users.models import User


_EXTERNAL_APPT_SYS = "https://ozonehis.test/ns/appointment-id"
_EXTERNAL_ENC_SYS = "https://ozonehis.test/ns/encounter-id"
_EXTERNAL_MED_SYS = "https://ozonehis.test/ns/medicationrequest-id"


class _FhirExternalIdBase(TenantTestCase):

    def setUp(self):
        # Per-tenant Constance config: populate the external system URLs
        # used throughout the suite.
        constance_config.fhir_external_appointment_system = _EXTERNAL_APPT_SYS
        constance_config.fhir_external_encounter_system = _EXTERNAL_ENC_SYS
        constance_config.fhir_external_medicationrequest_system = _EXTERNAL_MED_SYS

        self.practitioner = User.objects.create_user(
            email="doc@example.com", password="x", is_practitioner=True,
        )
        self.patient = User.objects.create_user(
            email="pat@example.com", password="x",
        )
        self.client = APIClient()
        self.client.force_authenticate(user=self.practitioner)

    def _create_appointment(self, *, external_id=None, scheduled_at=None):
        appt = Appointment.objects.create(
            created_by=self.practitioner,
            scheduled_at=scheduled_at or (timezone.now() + timedelta(days=1)),
            status=AppointmentStatus.scheduled,
            external_id=external_id,
        )
        Participant.objects.create(
            appointment=appt, user=self.patient, is_confirmed=True,
        )
        return appt


class AppointmentCreateWithExternalIdTests(_FhirExternalIdBase):

    def test_post_stores_external_id_from_identifier_array(self):
        payload = {
            "resourceType": "Appointment",
            "status": "booked",
            "start": (timezone.now() + timedelta(days=2)).isoformat(),
            "end": (timezone.now() + timedelta(days=2, hours=1)).isoformat(),
            "identifier": [
                {"system": _EXTERNAL_APPT_SYS, "value": "OZ-7"},
            ],
            "participant": [
                {
                    "actor": {"reference": f"Patient/{self.patient.pk}"},
                    "status": "accepted",
                },
            ],
        }
        url = reverse("appointment-list")
        response = self.client.post(
            f"{url}?format=fhir",
            data=json.dumps(payload),
            content_type="application/fhir+json",
        )
        self.assertEqual(response.status_code, 201, response.content)
        appt = Appointment.objects.get(pk=response.data["id"])
        self.assertEqual(appt.external_id, "OZ-7")
        # Response must echo both identifiers.
        systems = {ident["system"] for ident in response.data["identifier"]}
        self.assertIn(get_identifier_system("Appointment"), systems)
        self.assertIn(_EXTERNAL_APPT_SYS, systems)

    def test_post_without_external_identifier_leaves_field_null(self):
        payload = {
            "resourceType": "Appointment",
            "status": "booked",
            "start": (timezone.now() + timedelta(days=2)).isoformat(),
            "end": (timezone.now() + timedelta(days=2, hours=1)).isoformat(),
            "participant": [
                {
                    "actor": {"reference": f"Patient/{self.patient.pk}"},
                    "status": "accepted",
                },
            ],
        }
        url = reverse("appointment-list")
        response = self.client.post(
            f"{url}?format=fhir",
            data=json.dumps(payload),
            content_type="application/fhir+json",
        )
        self.assertEqual(response.status_code, 201)
        appt = Appointment.objects.get(pk=response.data["id"])
        self.assertIsNone(appt.external_id)


class AppointmentSearchByIdentifierTests(_FhirExternalIdBase):

    def test_search_by_external_system_pipe_value(self):
        self._create_appointment(external_id="OZ-1")
        self._create_appointment()
        url = reverse("appointment-list")
        response = self.client.get(
            f"{url}?format=fhir&identifier={_EXTERNAL_APPT_SYS}|OZ-1",
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["total"], 1)

    def test_search_by_canonical_pk_still_works(self):
        appt = self._create_appointment()
        url = reverse("appointment-list")
        response = self.client.get(
            f"{url}?format=fhir&identifier={appt.pk}",
        )
        self.assertEqual(response.status_code, 200)
        self.assertGreaterEqual(response.data["total"], 1)

    def test_search_with_unknown_system_returns_empty_bundle(self):
        self._create_appointment(external_id="OZ-X")
        url = reverse("appointment-list")
        response = self.client.get(
            f"{url}?format=fhir&identifier=https://nope.example|OZ-X",
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["total"], 0)


class AppointmentConditionalUpdateTests(_FhirExternalIdBase):

    def test_put_by_external_identifier(self):
        appt = self._create_appointment(external_id="OZ-7")
        payload = {
            "resourceType": "Appointment",
            "status": "cancelled",
            "start": appt.scheduled_at.isoformat(),
            "identifier": [
                {"system": _EXTERNAL_APPT_SYS, "value": "OZ-7"},
            ],
        }
        url = reverse("appointment-list")
        response = self.client.put(
            f"{url}?identifier={_EXTERNAL_APPT_SYS}|OZ-7",
            data=json.dumps(payload),
            content_type="application/fhir+json",
        )
        self.assertEqual(response.status_code, 200, response.content)
        appt.refresh_from_db()
        self.assertEqual(appt.status, AppointmentStatus.cancelled)

    def test_put_with_no_match_returns_404(self):
        payload = {
            "resourceType": "Appointment",
            "status": "cancelled",
            "start": timezone.now().isoformat(),
        }
        url = reverse("appointment-list")
        response = self.client.put(
            f"{url}?identifier={_EXTERNAL_APPT_SYS}|UNKNOWN",
            data=json.dumps(payload),
            content_type="application/fhir+json",
        )
        self.assertEqual(response.status_code, 404)


class AppointmentConditionalDeleteTests(_FhirExternalIdBase):

    def test_delete_by_external_identifier_soft_cancels(self):
        appt = self._create_appointment(external_id="OZ-7")
        url = reverse("appointment-list")
        response = self.client.delete(
            f"{url}?identifier={_EXTERNAL_APPT_SYS}|OZ-7",
            HTTP_ACCEPT="application/fhir+json",
        )
        self.assertEqual(response.status_code, 204)
        appt.refresh_from_db()
        self.assertEqual(appt.status, AppointmentStatus.cancelled)


class EncounterByAppointmentExternalIdTests(_FhirExternalIdBase):

    def test_encounter_search_by_linked_appointment_external_id(self):
        consultation = Consultation.objects.create(
            title="Note", created_by=self.practitioner, beneficiary=self.patient,
        )
        appt = self._create_appointment(external_id="OZ-9")
        appt.consultation = consultation
        appt.save()

        url = reverse("consultation-list")
        response = self.client.get(
            f"{url}?format=fhir&appointment={_EXTERNAL_APPT_SYS}|OZ-9",
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["total"], 1)
        self.assertEqual(int(response.data["entry"][0]["resource"]["id"]), consultation.pk)


class EncounterCreateWithExternalIdTests(_FhirExternalIdBase):

    def test_encounter_post_stores_external_id(self):
        payload = {
            "resourceType": "Encounter",
            "status": "in-progress",
            "class": {
                "system": "http://terminology.hl7.org/CodeSystem/v3-ActCode",
                "code": "AMB",
            },
            "subject": {"reference": f"Patient/{self.patient.pk}"},
            "identifier": [
                {"system": _EXTERNAL_ENC_SYS, "value": "OZ-ENC-3"},
            ],
        }
        url = reverse("consultation-list")
        response = self.client.post(
            f"{url}?format=fhir",
            data=json.dumps(payload),
            content_type="application/fhir+json",
        )
        self.assertEqual(response.status_code, 201, response.content)
        consultation = Consultation.objects.get(pk=response.data["id"])
        self.assertEqual(consultation.external_id, "OZ-ENC-3")


class NativeApiHidesExternalIdTests(_FhirExternalIdBase):

    def test_native_get_excludes_external_id(self):
        appt = self._create_appointment(external_id="OZ-HIDDEN")
        url = reverse("appointment-detail", kwargs={"pk": appt.pk})
        response = self.client.get(url)
        self.assertEqual(response.status_code, 200)
        self.assertNotIn("external_id", response.data)
