import json

from django.urls import reverse
from django_tenants.test.cases import TenantTestCase
from fhir.resources.R4B.bundle import Bundle
from fhir.resources.R4B.medicationrequest import MedicationRequest as FhirMedicationRequest
from rest_framework.test import APIClient

from consultations.fhir import PrescriptionFhirMapper
from consultations.models import Consultation, Prescription, PrescriptionStatus
from users.models import User


class _PrescriptionBase(TenantTestCase):

    def setUp(self):
        self.practitioner = User.objects.create_user(
            email="doc@example.com", password="x",
            first_name="Alice", last_name="Doc",
            is_practitioner=True,
        )
        self.patient = User.objects.create_user(
            email="pat@example.com", password="x",
            first_name="John", last_name="Doe",
        )
        self.consultation = Consultation.objects.create(
            title="Flu",
            created_by=self.practitioner,
            beneficiary=self.patient,
        )
        self.prescription = Prescription.objects.create(
            consultation=self.consultation,
            created_by=self.practitioner,
            status=PrescriptionStatus.prescribed.value,
            medication_name="Ibuprofen 400mg",
            dosage="1 tablet",
            frequency="3 times a day",
            duration="5 days",
            instructions="Take with food",
            notes="Avoid alcohol",
        )
        self.client = APIClient()
        self.client.force_authenticate(user=self.practitioner)


class PrescriptionMapperUnitTests(_PrescriptionBase):

    def test_to_fhir_validates(self):
        data = PrescriptionFhirMapper().to_fhir(self.prescription)
        FhirMedicationRequest.model_validate(data)
        self.assertEqual(data["status"], "active")
        self.assertEqual(data["intent"], "order")
        self.assertEqual(data["medicationCodeableConcept"]["text"], "Ibuprofen 400mg")
        self.assertEqual(data["subject"]["reference"], f"Patient/{self.patient.pk}")
        self.assertEqual(data["encounter"]["reference"], f"Encounter/{self.consultation.pk}")
        self.assertEqual(data["requester"]["reference"], f"Practitioner/{self.practitioner.pk}")
        self.assertIn("1 tablet", data["dosageInstruction"][0]["text"])
        self.assertEqual(data["note"][0]["text"], "Avoid alcohol")


class PrescriptionReadTests(_PrescriptionBase):

    def test_retrieve(self):
        url = reverse("prescription-detail", kwargs={"pk": self.prescription.pk})
        response = self.client.get(f"{url}?format=fhir")
        self.assertEqual(response.status_code, 200, response.data)
        FhirMedicationRequest.model_validate(response.data)
        self.assertEqual(response.data["resourceType"], "MedicationRequest")

    def test_list_bundle(self):
        url = reverse("prescription-list")
        response = self.client.get(f"{url}?format=fhir")
        self.assertEqual(response.status_code, 200)
        Bundle.model_validate(response.data)
        self.assertEqual(response.data["type"], "searchset")
        self.assertEqual(response.data["total"], 1)


class PrescriptionSearchTests(_PrescriptionBase):

    def test_filter_by_patient(self):
        other_patient = User.objects.create_user(email="other@example.com", password="x")
        other_cons = Consultation.objects.create(
            title="Other", created_by=self.practitioner, beneficiary=other_patient,
        )
        Prescription.objects.create(
            consultation=other_cons,
            created_by=self.practitioner,
            status=PrescriptionStatus.prescribed.value,
            medication_name="Paracetamol",
            dosage="1g",
            frequency="x3/day",
        )
        url = reverse("prescription-list")
        response = self.client.get(
            f"{url}?format=fhir&patient=Patient/{self.patient.pk}"
        )
        self.assertEqual(response.data["total"], 1)

    def test_filter_by_status(self):
        Prescription.objects.create(
            consultation=self.consultation,
            created_by=self.practitioner,
            status=PrescriptionStatus.draft.value,
            medication_name="Paracetamol",
            dosage="1g",
            frequency="x3/day",
        )
        url = reverse("prescription-list")
        response = self.client.get(f"{url}?format=fhir&status=active")
        self.assertEqual(response.data["total"], 1)

    def test_filter_by_encounter(self):
        url = reverse("prescription-list")
        response = self.client.get(
            f"{url}?format=fhir&encounter=Encounter/{self.consultation.pk}"
        )
        self.assertEqual(response.data["total"], 1)


class PrescriptionWriteTests(_PrescriptionBase):

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
            "resourceType": "MedicationRequest",
            "status": "active",
            "intent": "order",
            "medicationCodeableConcept": {"text": "Amoxicillin 500mg"},
            "subject": {"reference": f"Patient/{self.patient.pk}"},
            "encounter": {"reference": f"Encounter/{self.consultation.pk}"},
            "dosageInstruction": [{"text": "1 capsule three times a day"}],
        }
        response = self._fhir_post(reverse("prescription-list"), payload)
        self.assertEqual(response.status_code, 201, response.data)
        created = Prescription.objects.exclude(pk=self.prescription.pk).get()
        self.assertEqual(created.medication_name, "Amoxicillin 500mg")
        self.assertEqual(created.status, PrescriptionStatus.prescribed.value)
        self.assertEqual(created.consultation, self.consultation)

    def test_create_without_encounter_rejected(self):
        payload = {
            "resourceType": "MedicationRequest",
            "status": "active",
            "intent": "order",
            "medicationCodeableConcept": {"text": "Amoxicillin"},
            "subject": {"reference": f"Patient/{self.patient.pk}"},
        }
        response = self._fhir_post(reverse("prescription-list"), payload)
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.data["resourceType"], "OperationOutcome")

    def test_update_status(self):
        payload = {
            "resourceType": "MedicationRequest",
            "id": str(self.prescription.pk),
            "status": "completed",
            "intent": "order",
            "medicationCodeableConcept": {"text": "Ibuprofen 400mg"},
            "subject": {"reference": f"Patient/{self.patient.pk}"},
            "encounter": {"reference": f"Encounter/{self.consultation.pk}"},
        }
        url = reverse("prescription-detail", kwargs={"pk": self.prescription.pk})
        response = self._fhir_put(url, payload)
        self.assertEqual(response.status_code, 200, response.data)
        self.prescription.refresh_from_db()
        self.assertEqual(self.prescription.status, PrescriptionStatus.dispensed.value)

    def test_delete_soft_cancels(self):
        url = reverse("prescription-detail", kwargs={"pk": self.prescription.pk})
        response = self.client.delete(f"{url}?format=fhir")
        self.assertEqual(response.status_code, 204)
        self.prescription.refresh_from_db()
        self.assertEqual(self.prescription.status, PrescriptionStatus.cancelled.value)
