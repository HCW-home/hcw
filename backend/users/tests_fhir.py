import json
from datetime import date

from django.urls import reverse
from django_tenants.test.cases import TenantTestCase
from fhir.resources.R4B.bundle import Bundle
from fhir.resources.R4B.patient import Patient as FhirPatient
from fhir.resources.R4B.practitioner import Practitioner as FhirPractitioner
from rest_framework.test import APIClient

from users.fhir import PatientFhirMapper, PractitionerFhirMapper
from users.models import Gender, Language, Organisation, Speciality, User


class _UsersFhirBase(TenantTestCase):

    def setUp(self):
        self.organisation = Organisation.objects.create(name="Clinic")
        self.practitioner = User.objects.create_user(
            email="doc@example.com",
            password="x",
            is_practitioner=True,
            first_name="Alice",
            last_name="Doc",
            main_organisation=self.organisation,
        )
        self.patient = User.objects.create_user(
            email="john@example.com",
            password="x",
            first_name="John",
            last_name="Doe",
            mobile_phone_number="+33600000000",
            date_of_birth=date(1985, 5, 12),
            gender=Gender.male.value,
            main_organisation=self.organisation,
            city="Paris",
            country="FR",
        )
        self.client = APIClient()
        self.client.force_authenticate(user=self.practitioner)


class PatientFhirMapperUnitTests(_UsersFhirBase):

    def test_to_fhir_validates(self):
        data = PatientFhirMapper().to_fhir(self.patient)
        FhirPatient.model_validate(data)
        self.assertEqual(data["gender"], "male")
        self.assertEqual(data["birthDate"], "1985-05-12")
        self.assertEqual(data["name"][0]["family"], "Doe")
        self.assertIn("managingOrganization", data)

    def test_from_fhir_creates_temporary_user_without_contact(self):
        payload = {
            "resourceType": "Patient",
            "name": [{"family": "Anon", "given": ["User"]}],
            "gender": "unknown",
        }
        instance = PatientFhirMapper().from_fhir(payload)
        self.assertTrue(instance.temporary)
        self.assertFalse(instance.is_practitioner)


class PatientFhirReadTests(_UsersFhirBase):

    def test_retrieve(self):
        url = reverse("patient-detail", kwargs={"pk": self.patient.pk})
        response = self.client.get(f"{url}?format=fhir")
        self.assertEqual(response.status_code, 200, response.data)
        FhirPatient.model_validate(response.data)
        self.assertEqual(response.data["resourceType"], "Patient")
        self.assertEqual(response.data["id"], str(self.patient.pk))

    def test_list_bundle(self):
        url = reverse("patient-list")
        response = self.client.get(f"{url}?format=fhir")
        self.assertEqual(response.status_code, 200)
        Bundle.model_validate(response.data)
        self.assertEqual(response.data["type"], "searchset")
        self.assertEqual(response.data["total"], 1)

    def test_practitioner_excluded_from_patient_list(self):
        url = reverse("patient-list")
        response = self.client.get(f"{url}?format=fhir")
        ids = [e["resource"]["id"] for e in response.data["entry"]]
        self.assertIn(str(self.patient.pk), ids)
        self.assertNotIn(str(self.practitioner.pk), ids)


class PatientFhirSearchTests(_UsersFhirBase):

    def test_search_by_name(self):
        User.objects.create_user(
            email="jane@example.com", password="x",
            first_name="Jane", last_name="Smith",
        )
        url = reverse("patient-list")
        response = self.client.get(f"{url}?format=fhir&family=Doe")
        self.assertEqual(response.data["total"], 1)

    def test_search_by_gender(self):
        User.objects.create_user(
            email="jane@example.com", password="x",
            first_name="Jane", last_name="Smith", gender=Gender.female.value,
        )
        url = reverse("patient-list")
        response = self.client.get(f"{url}?format=fhir&gender=female")
        self.assertEqual(response.data["total"], 1)

    def test_search_by_email(self):
        url = reverse("patient-list")
        response = self.client.get(f"{url}?format=fhir&email=john@example.com")
        self.assertEqual(response.data["total"], 1)


class PatientFhirWriteTests(_UsersFhirBase):

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
            "resourceType": "Patient",
            "active": True,
            "name": [{"family": "Martin", "given": ["Pierre"]}],
            "gender": "male",
            "birthDate": "1990-01-15",
            "telecom": [{"system": "email", "value": "pierre@example.com"}],
        }
        response = self._fhir_post(reverse("patient-list"), payload)
        self.assertEqual(response.status_code, 201, response.data)
        self.assertIn("Location", response)
        created = User.objects.get(email="pierre@example.com")
        self.assertFalse(created.is_practitioner)
        self.assertEqual(created.last_name, "Martin")
        self.assertEqual(created.gender, Gender.male.value)

    def test_update_replaces_fields(self):
        payload = {
            "resourceType": "Patient",
            "id": str(self.patient.pk),
            "name": [{"family": "Doe", "given": ["Johnathan"]}],
            "gender": "male",
            "birthDate": "1985-05-12",
            "telecom": [{"system": "email", "value": "john@example.com"}],
        }
        url = reverse("patient-detail", kwargs={"pk": self.patient.pk})
        response = self._fhir_put(url, payload)
        self.assertEqual(response.status_code, 200, response.data)
        self.patient.refresh_from_db()
        self.assertEqual(self.patient.first_name, "Johnathan")

    def test_delete_soft_deletes(self):
        url = reverse("patient-detail", kwargs={"pk": self.patient.pk})
        response = self.client.delete(f"{url}?format=fhir")
        self.assertEqual(response.status_code, 204)
        self.patient.refresh_from_db()
        self.assertFalse(self.patient.is_active)


class PractitionerFhirTests(_UsersFhirBase):

    def test_retrieve_practitioner(self):
        spec = Speciality.objects.create(name="Cardiology")
        self.practitioner.specialities.add(spec)
        url = reverse("practitioner-detail", kwargs={"pk": self.practitioner.pk})
        response = self.client.get(f"{url}?format=fhir")
        self.assertEqual(response.status_code, 200, response.data)
        FhirPractitioner.model_validate(response.data)
        self.assertEqual(response.data["resourceType"], "Practitioner")
        self.assertEqual(len(response.data["qualification"]), 1)

    def test_list_excludes_patients(self):
        url = reverse("practitioner-list")
        response = self.client.get(f"{url}?format=fhir")
        ids = [e["resource"]["id"] for e in response.data["entry"]]
        self.assertIn(str(self.practitioner.pk), ids)
        self.assertNotIn(str(self.patient.pk), ids)
