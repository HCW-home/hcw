import json

from constance.test import override_config
from django.urls import reverse
from django_tenants.test.cases import TenantTestCase
from rest_framework.test import APIClient

from users.models import Organisation, User


class ForceTemporaryPatientsBase(TenantTestCase):
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
        self.client = APIClient()
        self.client.force_authenticate(user=self.practitioner)


class ForceTemporaryPatientsFlagDisabledTests(ForceTemporaryPatientsBase):
    """Regression: when the flag is off, behavior is unchanged."""

    def test_patient_creation_respects_explicit_temporary_false(self):
        url = reverse("patient-list")
        response = self.client.post(
            url,
            data={
                "email": "jane@example.com",
                "first_name": "Jane",
                "last_name": "Doe",
                "temporary": False,
            },
            format="json",
        )
        self.assertEqual(response.status_code, 201, response.data)
        created = User.objects.get(email="jane@example.com")
        self.assertFalse(created.temporary)


@override_config(force_temporary_patients=True)
class ForceTemporaryPatientsFlagEnabledTests(ForceTemporaryPatientsBase):
    """When the flag is on, all newly created patients must be temporary."""

    def test_patient_creation_without_temporary_forces_true(self):
        url = reverse("patient-list")
        response = self.client.post(
            url,
            data={
                "email": "jane@example.com",
                "first_name": "Jane",
                "last_name": "Doe",
            },
            format="json",
        )
        self.assertEqual(response.status_code, 201, response.data)
        created = User.objects.get(email="jane@example.com")
        self.assertTrue(created.temporary)

    def test_patient_creation_with_explicit_temporary_false_returns_400(self):
        url = reverse("patient-list")
        response = self.client.post(
            url,
            data={
                "email": "jane@example.com",
                "first_name": "Jane",
                "last_name": "Doe",
                "temporary": False,
            },
            format="json",
        )
        self.assertEqual(response.status_code, 400, response.data)
        self.assertIn("temporary", response.data)
        self.assertFalse(User.objects.filter(email="jane@example.com").exists())

    def test_editing_existing_permanent_patient_preserves_temporary_value(self):
        existing = User.objects.create_user(
            email="existing@example.com",
            password="x",
            first_name="Existing",
            last_name="Patient",
            temporary=False,
        )
        url = reverse("patient-detail", kwargs={"pk": existing.pk})
        response = self.client.patch(
            url,
            data={"first_name": "Updated"},
            format="json",
        )
        self.assertEqual(response.status_code, 200, response.data)
        existing.refresh_from_db()
        self.assertFalse(existing.temporary)
        self.assertEqual(existing.first_name, "Updated")

    def test_user_create_with_explicit_temporary_false_returns_400(self):
        url = reverse("user-list")
        response = self.client.post(
            url,
            data={
                "email": "another@example.com",
                "first_name": "Another",
                "last_name": "One",
                "temporary": False,
            },
            format="json",
        )
        self.assertEqual(response.status_code, 400, response.data)

    def test_temporary_user_merge_keeps_temporary_flag(self):
        temp = User.objects.create_user(
            email="temp@example.com",
            password="x",
            temporary=True,
        )
        url = reverse("user-list")
        response = self.client.post(
            url,
            data={
                "email": "temp@example.com",
                "first_name": "NewName",
                "last_name": "Ref",
            },
            format="json",
        )
        self.assertEqual(response.status_code, 200, response.data)
        temp.refresh_from_db()
        self.assertTrue(temp.temporary)

    def test_fhir_patient_post_forces_temporary_true(self):
        payload = {
            "resourceType": "Patient",
            "active": True,
            "name": [{"family": "Martin", "given": ["Pierre"]}],
            "gender": "male",
            "telecom": [{"system": "email", "value": "pierre@example.com"}],
        }
        url = reverse("patient-list")
        response = self.client.post(
            url,
            data=json.dumps(payload),
            content_type="application/fhir+json",
            HTTP_ACCEPT="application/fhir+json",
        )
        self.assertEqual(response.status_code, 201, response.data)
        created = User.objects.get(email="pierre@example.com")
        self.assertTrue(created.temporary)
