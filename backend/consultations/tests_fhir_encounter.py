import json
from datetime import timedelta

from django.urls import reverse
from django.utils import timezone
from django_tenants.test.cases import TenantTestCase
from fhir.resources.R4B.bundle import Bundle
from fhir.resources.R4B.encounter import Encounter as FhirEncounter
from rest_framework.test import APIClient

from consultations.fhir import EncounterFhirMapper
from consultations.models import Appointment, Consultation, Type
from users.models import Organisation, User


class _EncounterBase(TenantTestCase):

    def setUp(self):
        self.organisation = Organisation.objects.create(name="Clinic")
        self.practitioner = User.objects.create_user(
            email="doc@example.com", password="x",
            first_name="Alice", last_name="Doc",
            is_practitioner=True,
            main_organisation=self.organisation,
        )
        self.patient = User.objects.create_user(
            email="pat@example.com", password="x",
            first_name="John", last_name="Doe",
        )
        self.consultation = Consultation.objects.create(
            title="Follow-up",
            description="Check-up",
            created_by=self.practitioner,
            beneficiary=self.patient,
        )
        self.client = APIClient()
        self.client.force_authenticate(user=self.practitioner)


class EncounterMapperUnitTests(_EncounterBase):

    def test_to_fhir_validates(self):
        data = EncounterFhirMapper().to_fhir(self.consultation)
        FhirEncounter.model_validate(data)
        self.assertEqual(data["resourceType"], "Encounter")
        self.assertEqual(data["status"], "in-progress")
        self.assertEqual(data["subject"]["reference"], f"Patient/{self.patient.pk}")
        self.assertIn("serviceProvider", data)

    def test_status_finished_when_closed(self):
        self.consultation.closed_at = timezone.now()
        self.consultation.save()
        data = EncounterFhirMapper().to_fhir(self.consultation)
        self.assertEqual(data["status"], "finished")
        self.assertIn("end", data["period"])

    def test_class_from_latest_appointment(self):
        Appointment.objects.create(
            consultation=self.consultation,
            created_by=self.practitioner,
            scheduled_at=timezone.now() + timedelta(days=1),
            type=Type.inperson.value,
        )
        data = EncounterFhirMapper().to_fhir(self.consultation)
        self.assertEqual(data["class"]["code"], "AMB")


class EncounterReadTests(_EncounterBase):

    def test_retrieve(self):
        url = reverse("consultation-detail", kwargs={"pk": self.consultation.pk})
        response = self.client.get(f"{url}?format=fhir")
        self.assertEqual(response.status_code, 200, response.data)
        FhirEncounter.model_validate(response.data)
        self.assertEqual(response.data["id"], str(self.consultation.pk))

    def test_list_bundle(self):
        url = reverse("consultation-list")
        response = self.client.get(f"{url}?format=fhir")
        self.assertEqual(response.status_code, 200)
        Bundle.model_validate(response.data)
        self.assertEqual(response.data["type"], "searchset")


class EncounterSearchTests(_EncounterBase):

    def test_filter_by_patient(self):
        other_patient = User.objects.create_user(email="other@example.com", password="x")
        Consultation.objects.create(
            title="Other", created_by=self.practitioner, beneficiary=other_patient,
        )
        url = reverse("consultation-list")
        response = self.client.get(
            f"{url}?format=fhir&patient=Patient/{self.patient.pk}"
        )
        self.assertEqual(response.data["total"], 1)

    def test_filter_by_status_finished(self):
        Consultation.objects.create(
            title="Closed",
            created_by=self.practitioner,
            beneficiary=self.patient,
            closed_at=timezone.now(),
        )
        url = reverse("consultation-list")
        response = self.client.get(f"{url}?format=fhir&status=finished")
        self.assertEqual(response.data["total"], 1)

    def test_filter_by_status_in_progress(self):
        Consultation.objects.create(
            title="Closed",
            created_by=self.practitioner,
            beneficiary=self.patient,
            closed_at=timezone.now(),
        )
        url = reverse("consultation-list")
        response = self.client.get(f"{url}?format=fhir&status=in-progress")
        self.assertEqual(response.data["total"], 1)


class EncounterWriteTests(_EncounterBase):

    def _fhir_post(self, url, payload):
        return self.client.post(
            url, data=json.dumps(payload),
            content_type="application/fhir+json",
            HTTP_ACCEPT="application/fhir+json",
        )

    def _fhir_put(self, url, payload):
        return self.client.put(
            url, data=json.dumps(payload),
            content_type="application/fhir+json",
            HTTP_ACCEPT="application/fhir+json",
        )

    def test_create(self):
        payload = {
            "resourceType": "Encounter",
            "status": "in-progress",
            "class": {
                "system": "http://terminology.hl7.org/CodeSystem/v3-ActCode",
                "code": "VR",
            },
            "subject": {"reference": f"Patient/{self.patient.pk}"},
        }
        response = self._fhir_post(reverse("consultation-list"), payload)
        self.assertEqual(response.status_code, 201, response.data)
        created = Consultation.objects.exclude(pk=self.consultation.pk).get()
        self.assertEqual(created.beneficiary, self.patient)
        self.assertEqual(created.created_by, self.practitioner)

    def test_update_status_to_finished_closes_consultation(self):
        payload = {
            "resourceType": "Encounter",
            "id": str(self.consultation.pk),
            "status": "finished",
            "class": {
                "system": "http://terminology.hl7.org/CodeSystem/v3-ActCode",
                "code": "VR",
            },
            "subject": {"reference": f"Patient/{self.patient.pk}"},
        }
        url = reverse("consultation-detail", kwargs={"pk": self.consultation.pk})
        response = self._fhir_put(url, payload)
        self.assertEqual(response.status_code, 200, response.data)
        self.consultation.refresh_from_db()
        self.assertIsNotNone(self.consultation.closed_at)

    def test_delete_soft_closes(self):
        url = reverse("consultation-detail", kwargs={"pk": self.consultation.pk})
        response = self.client.delete(f"{url}?format=fhir")
        self.assertEqual(response.status_code, 204)
        self.consultation.refresh_from_db()
        self.assertIsNotNone(self.consultation.closed_at)
