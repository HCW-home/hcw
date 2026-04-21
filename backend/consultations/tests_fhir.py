import json
from datetime import timedelta

from django.urls import reverse
from django.utils import timezone
from django_tenants.test.cases import TenantTestCase
from fhir.resources.R4B.appointment import Appointment as FhirAppointment
from fhir.resources.R4B.bundle import Bundle
from fhir.resources.R4B.capabilitystatement import CapabilityStatement
from fhir.resources.R4B.operationoutcome import OperationOutcome
from rest_framework.test import APIClient

from consultations.fhir import AppointmentFhirMapper
from consultations.models import Appointment, AppointmentStatus, Consultation, Participant
from users.models import User


class _AppointmentFhirBase(TenantTestCase):

    def setUp(self):
        self.practitioner = User.objects.create_user(
            email="doc@example.com",
            password="x",
            is_practitioner=True,
        )
        self.patient = User.objects.create_user(
            email="pat@example.com",
            password="x",
        )
        self.consultation = Consultation.objects.create(
            title="Follow-up",
            description="Check pulse",
            created_by=self.practitioner,
            beneficiary=self.patient,
        )
        self.appointment = Appointment.objects.create(
            created_by=self.practitioner,
            consultation=self.consultation,
            scheduled_at=timezone.now() + timedelta(days=1),
            status=AppointmentStatus.scheduled,
        )
        Participant.objects.create(
            appointment=self.appointment,
            user=self.patient,
            is_confirmed=True,
        )
        self.client = APIClient()
        self.client.force_authenticate(user=self.practitioner)


class AppointmentFhirReadTests(_AppointmentFhirBase):

    def test_retrieve_via_query_param(self):
        url = reverse("appointment-detail", kwargs={"pk": self.appointment.pk})
        response = self.client.get(f"{url}?format=fhir")
        self.assertEqual(response.status_code, 200)
        FhirAppointment.model_validate(response.data)
        self.assertEqual(response.data["resourceType"], "Appointment")
        self.assertEqual(response.data["status"], "booked")
        self.assertIn("meta", response.data)
        self.assertTrue(response["ETag"].startswith('W/"'))

    def test_retrieve_via_accept_header(self):
        url = reverse("appointment-detail", kwargs={"pk": self.appointment.pk})
        response = self.client.get(url, HTTP_ACCEPT="application/fhir+json")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response["Content-Type"].split(";")[0], "application/fhir+json")
        FhirAppointment.model_validate(response.data)

    def test_list_returns_bundle(self):
        # A second appointment for pagination
        Appointment.objects.create(
            created_by=self.practitioner,
            consultation=self.consultation,
            scheduled_at=timezone.now() + timedelta(days=2),
            status=AppointmentStatus.scheduled,
        )
        url = reverse("appointment-list")
        response = self.client.get(f"{url}?format=fhir")
        self.assertEqual(response.status_code, 200)
        Bundle.model_validate(response.data)
        self.assertEqual(response.data["type"], "searchset")
        self.assertEqual(response.data["total"], 2)
        self.assertTrue(response.data["entry"][0]["fullUrl"])
        self.assertEqual(response.data["entry"][0]["search"]["mode"], "match")


class AppointmentFhirSearchTests(_AppointmentFhirBase):

    def test_filter_by_status(self):
        Appointment.objects.create(
            created_by=self.practitioner,
            consultation=self.consultation,
            scheduled_at=timezone.now() + timedelta(days=3),
            status=AppointmentStatus.cancelled,
        )
        url = reverse("appointment-list")
        response = self.client.get(f"{url}?format=fhir&status=booked")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["total"], 1)

    def test_filter_by_patient(self):
        other_patient = User.objects.create_user(email="other@example.com", password="x")
        other = Appointment.objects.create(
            created_by=self.practitioner,
            scheduled_at=timezone.now() + timedelta(days=3),
            status=AppointmentStatus.scheduled,
        )
        Participant.objects.create(appointment=other, user=other_patient)
        url = reverse("appointment-list")
        response = self.client.get(f"{url}?format=fhir&patient=Patient/{self.patient.pk}")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["total"], 1)

    def test_filter_by_date(self):
        far_future = timezone.now() + timedelta(days=365)
        Appointment.objects.create(
            created_by=self.practitioner,
            scheduled_at=far_future,
            status=AppointmentStatus.scheduled,
        )
        url = reverse("appointment-list")
        cutoff = (timezone.now() + timedelta(days=30)).date().isoformat()
        response = self.client.get(f"{url}?format=fhir&date=ge{cutoff}")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["total"], 1)


class AppointmentFhirWriteTests(_AppointmentFhirBase):

    def _fhir_post(self, url, payload):
        return self.client.post(
            url,
            data=json.dumps(payload),
            content_type="application/fhir+json",
            HTTP_ACCEPT="application/fhir+json",
        )

    def _fhir_put(self, url, payload):
        return self.client.put(
            url,
            data=json.dumps(payload),
            content_type="application/fhir+json",
            HTTP_ACCEPT="application/fhir+json",
        )

    def test_create_from_fhir_payload(self):
        payload = {
            "resourceType": "Appointment",
            "status": "booked",
            "start": (timezone.now() + timedelta(days=5)).isoformat(),
            "end": (timezone.now() + timedelta(days=5, minutes=30)).isoformat(),
            "description": "New slot",
            "participant": [
                {"actor": {"reference": f"Patient/{self.patient.pk}"}, "status": "accepted"},
            ],
        }
        response = self._fhir_post(reverse("appointment-list"), payload)
        self.assertEqual(response.status_code, 201, response.data)
        self.assertIn("Location", response)
        created = Appointment.objects.exclude(pk=self.appointment.pk).get()
        self.assertEqual(created.status, AppointmentStatus.scheduled)
        self.assertEqual(created.title, "New slot")
        self.assertTrue(
            Participant.objects.filter(appointment=created, user=self.patient, is_active=True).exists()
        )

    def test_update_via_put(self):
        payload = {
            "resourceType": "Appointment",
            "id": str(self.appointment.pk),
            "status": "cancelled",
            "start": self.appointment.scheduled_at.isoformat(),
            "participant": [
                {"actor": {"reference": f"Patient/{self.patient.pk}"}, "status": "accepted"},
            ],
        }
        url = reverse("appointment-detail", kwargs={"pk": self.appointment.pk})
        response = self._fhir_put(url, payload)
        self.assertEqual(response.status_code, 200, response.data)
        self.appointment.refresh_from_db()
        self.assertEqual(self.appointment.status, AppointmentStatus.cancelled)

    def test_delete_soft_deletes(self):
        url = reverse("appointment-detail", kwargs={"pk": self.appointment.pk})
        response = self.client.delete(f"{url}?format=fhir")
        self.assertEqual(response.status_code, 204)
        self.appointment.refresh_from_db()
        self.assertEqual(self.appointment.status, AppointmentStatus.cancelled)

    def test_invalid_payload_returns_operation_outcome(self):
        payload = {"resourceType": "Appointment", "status": "garbage"}
        response = self._fhir_post(reverse("appointment-list"), payload)
        self.assertEqual(response.status_code, 400)
        OperationOutcome.model_validate(response.data)
        self.assertEqual(response.data["resourceType"], "OperationOutcome")


class FhirCapabilityStatementTests(TenantTestCase):

    def test_metadata_endpoint(self):
        client = APIClient()
        response = client.get("/api/metadata/")
        self.assertEqual(response.status_code, 200)
        CapabilityStatement.model_validate(response.data)
        types = [r["type"] for r in response.data["rest"][0]["resource"]]
        self.assertIn("Appointment", types)


class AppointmentFhirMapperUnitTests(_AppointmentFhirBase):

    def test_to_fhir_validates(self):
        data = AppointmentFhirMapper().to_fhir(self.appointment)
        FhirAppointment.model_validate(data)
        self.assertEqual(data["status"], "booked")
        self.assertEqual(data["participant"][0]["actor"]["reference"], f"Patient/{self.patient.pk}")

    def test_round_trip(self):
        mapper = AppointmentFhirMapper()
        data = mapper.to_fhir(self.appointment)

        class _Req:
            user = self.practitioner
        instance = mapper.from_fhir(data, instance=Appointment(pk=None, created_by=self.practitioner),
                                    context={"request": _Req()})
        self.assertEqual(instance.status, AppointmentStatus.scheduled)
