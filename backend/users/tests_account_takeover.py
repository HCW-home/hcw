"""A practitioner must not take over or delete somebody else's account.

/api/users/, /api/patients/, /api/practitioners/ and the FHIR Patient and
Practitioner aliases serve the same User rows. Each of them used to be a way to
rewrite a superuser's email and then reset their password, to rewrite a
patient's email and then sign in with the code sent there, or to delete
accounts along with everything they created (audit C-02).
"""
import json
from urllib.parse import urlencode

from constance.test import override_config
from django.contrib.auth.models import Group
from django.urls import reverse
from django.utils import timezone
from django_tenants.test.cases import TenantTestCase
from rest_framework.test import APIClient

from fhir_server.references import build_identifier
from users.models import User
from users.views import PractitionerViewSet

ATTACKER_EMAIL = "attacker@evil.test"
LOCKED = "Only the patient can change this once they have signed in."


class _AccountTakeoverBase(TenantTestCase):

    def setUp(self):
        self.practitioner = User.objects.create_user(
            email="doc@example.com", is_practitioner=True
        )
        self.client = APIClient()
        self.client.force_authenticate(user=self.practitioner)

    def fhir(self, method, url, payload=None):
        return getattr(self.client, method)(
            url,
            data=json.dumps(payload) if payload is not None else None,
            content_type="application/fhir+json",
            HTTP_ACCEPT="application/fhir+json",
        )

    @staticmethod
    def patient_resource(user, email, *, upsert=False):
        """A FHIR Patient for `user` carrying `email`. With `upsert`, it names
        the user through its identifier and is meant for a create."""
        resource = {
            "resourceType": "Patient",
            "name": [{"family": "Doe", "given": ["John"]}],
            "telecom": [{"system": "email", "value": email}],
        }
        if upsert:
            resource["identifier"] = [build_identifier("Patient", user.pk)]
        else:
            resource["id"] = str(user.pk)
        return resource


class ProtectedAccountTests(_AccountTakeoverBase):
    """Accounts practitioners must leave alone, whatever the route."""

    def setUp(self):
        super().setUp()
        # Without the practitioner role, it is listed among the patients.
        self.admin = User.objects.create_superuser(
            email="admin@example.com",
            password="an-admin-password",
            is_practitioner=False,
        )

    def rewrite_email_attempts(self, target):
        return {
            "users": lambda: self.client.patch(
                reverse("user-detail", args=[target.pk]),
                {"email": ATTACKER_EMAIL},
                format="json",
            ),
            "patients": lambda: self.client.patch(
                reverse("patient-detail", args=[target.pk]),
                {"email": ATTACKER_EMAIL},
                format="json",
            ),
            "fhir update": lambda: self.fhir(
                "put",
                reverse("fhir-patient-item", args=[target.pk]),
                self.patient_resource(target, ATTACKER_EMAIL),
            ),
            "fhir upsert": lambda: self.fhir(
                "post",
                reverse("fhir-patient-collection"),
                self.patient_resource(target, ATTACKER_EMAIL, upsert=True),
            ),
        }

    def assert_email_cannot_be_rewritten(self, target):
        email = target.email
        for route, attempt in self.rewrite_email_attempts(target).items():
            with self.subTest(route=route):
                response = attempt()
                self.assertEqual(response.status_code, 403, response.data)
                target.refresh_from_db()
                self.assertEqual(target.email, email)
        self.assertFalse(User.objects.filter(email=ATTACKER_EMAIL).exists())

    def test_superuser_email_cannot_be_rewritten(self):
        self.assert_email_cannot_be_rewritten(self.admin)

    def test_practitioner_superuser_email_cannot_be_rewritten(self):
        # The default superuser is a practitioner: /api/practitioners/ is
        # covered by PractitionerEndpointTests.
        root = User.objects.create_superuser(
            email="root@example.com", password="a-root-password"
        )
        response = self.client.patch(
            reverse("user-detail", args=[root.pk]),
            {"email": ATTACKER_EMAIL},
            format="json",
        )
        self.assertEqual(response.status_code, 403)
        root.refresh_from_db()
        self.assertEqual(root.email, "root@example.com")

    def test_staff_email_cannot_be_rewritten(self):
        staff = User.objects.create_user(email="support@example.com", is_staff=True)
        self.assert_email_cannot_be_rewritten(staff)

    def test_group_member_email_cannot_be_rewritten(self):
        # PATCH on /api/users/ used to skip this check (PUT had it).
        member = User.objects.create_user(email="desk@example.com")
        member.groups.add(Group.objects.create(name="Front desk"))
        self.assert_email_cannot_be_rewritten(member)

    def test_colleague_cannot_be_rewritten_through_users(self):
        colleague = User.objects.create_user(
            email="colleague@example.com", is_practitioner=True
        )
        response = self.client.patch(
            reverse("user-detail", args=[colleague.pk]),
            {"email": ATTACKER_EMAIL},
            format="json",
        )
        self.assertEqual(response.status_code, 403)
        colleague.refresh_from_db()
        self.assertEqual(colleague.email, "colleague@example.com")

    def test_superuser_cannot_be_deactivated(self):
        attempts = {
            "patients": lambda: self.client.delete(
                reverse("patient-detail", args=[self.admin.pk])
            ),
            "fhir": lambda: self.fhir(
                "delete", reverse("fhir-patient-item", args=[self.admin.pk])
            ),
            "fhir conditional": lambda: self.fhir(
                "delete",
                f"{reverse('fhir-patient-collection')}?"
                + urlencode({"identifier": f"|{self.admin.pk}"}),
            ),
        }
        for route, attempt in attempts.items():
            with self.subTest(route=route):
                self.assertEqual(attempt().status_code, 403)
                self.admin.refresh_from_db()
                self.assertTrue(self.admin.is_active)

    def test_access_link_of_an_admin_is_not_handed_out(self):
        # A manual account's access link is a credential for it.
        User.objects.filter(pk=self.admin.pk).update(communication_method="manual")
        response = self.client.post(
            reverse("patient-access-url", args=[self.admin.pk])
        )
        self.assertEqual(response.status_code, 403)
        self.assertNotIn("access_url", response.data)


class PractitionerEndpointTests(_AccountTakeoverBase):
    """Practitioners are read-only through the API."""

    def setUp(self):
        super().setUp()
        self.colleague = User.objects.create_user(
            email="colleague@example.com", is_practitioner=True, first_name="Bob"
        )

    def test_practitioners_cannot_be_written(self):
        detail = reverse("practitioner-detail", args=[self.colleague.pk])
        fhir_item = reverse("fhir-practitioner-item", args=[self.colleague.pk])
        practitioner = {
            "resourceType": "Practitioner",
            "id": str(self.colleague.pk),
            "active": False,
            "telecom": [{"system": "email", "value": ATTACKER_EMAIL}],
        }
        attempts = {
            "patch": lambda: self.client.patch(
                detail, {"email": ATTACKER_EMAIL}, format="json"
            ),
            "put": lambda: self.client.put(
                detail, {"email": ATTACKER_EMAIL}, format="json"
            ),
            "delete": lambda: self.client.delete(detail),
            "fhir put": lambda: self.fhir("put", fhir_item, practitioner),
            "fhir delete": lambda: self.fhir("delete", fhir_item),
        }
        for route, attempt in attempts.items():
            with self.subTest(route=route):
                self.assertEqual(attempt().status_code, 405)
        self.colleague.refresh_from_db()
        self.assertEqual(self.colleague.email, "colleague@example.com")
        self.assertTrue(self.colleague.is_active)

    def test_practitioners_cannot_be_created(self):
        new_practitioner = {
            "resourceType": "Practitioner",
            "telecom": [{"system": "email", "value": ATTACKER_EMAIL}],
        }
        attempts = {
            "native": lambda: self.client.post(
                reverse("practitioner-list"), {"email": ATTACKER_EMAIL}, format="json"
            ),
            "fhir": lambda: self.fhir(
                "post", reverse("fhir-practitioner-collection"), new_practitioner
            ),
        }
        for route, attempt in attempts.items():
            with self.subTest(route=route):
                self.assertEqual(attempt().status_code, 405)
        self.assertFalse(User.objects.filter(email=ATTACKER_EMAIL).exists())

    def test_practitioners_can_still_be_read(self):
        response = self.client.get(reverse("fhir-practitioner-collection"))
        self.assertEqual(response.status_code, 200)
        ids = {entry["resource"]["id"] for entry in response.data["entry"]}
        self.assertIn(str(self.colleague.pk), ids)
        response = self.client.get(
            reverse("practitioner-detail", args=[self.colleague.pk])
        )
        self.assertEqual(response.status_code, 200)

    def test_capability_statement_advertises_reads_only(self):
        self.assertEqual(
            PractitionerViewSet.fhir_interactions(), ["read", "search-type"]
        )


class DeletionTests(_AccountTakeoverBase):

    def setUp(self):
        super().setUp()
        self.patient = User.objects.create_user(email="patient@example.com")

    def test_users_endpoint_deletes_nothing(self):
        # A row deletion cascades to everything the user created.
        response = self.client.delete(reverse("user-detail", args=[self.patient.pk]))
        self.assertEqual(response.status_code, 405)
        self.patient.refresh_from_db()
        self.assertTrue(self.patient.is_active)

    def test_patients_endpoint_only_deactivates(self):
        response = self.client.delete(
            reverse("patient-detail", args=[self.patient.pk])
        )
        self.assertEqual(response.status_code, 204)
        self.patient.refresh_from_db()
        self.assertFalse(self.patient.is_active)


class ClaimedAccountContactTests(_AccountTakeoverBase):
    """Once patients have claimed their account, its contact details are
    their credentials and nobody else may change them."""

    def setUp(self):
        super().setUp()
        self.patient = User.objects.create_user(
            email="patient@example.com",
            mobile_phone_number="+41791234567",
            first_name="John",
            created_by=self.practitioner,
            email_verified=True,
        )

    def patch(self, route, data, user=None):
        user = user or self.patient
        return self.client.patch(
            reverse(route, args=[user.pk]), data, format="json"
        )

    def test_contact_details_cannot_be_changed(self):
        changes = {
            "email": ATTACKER_EMAIL,
            "mobile_phone_number": "+41795556677",
            # The access link of a manual account is handed to practitioners.
            "communication_method": "manual",
            # A temporary account signs in with the link alone.
            "temporary": True,
        }
        for route in ("patient-detail", "user-detail"):
            for field, value in changes.items():
                with self.subTest(route=route, field=field):
                    response = self.patch(route, {field: value})
                    self.assertEqual(response.status_code, 400, response.data)
                    self.assertEqual(response.data[field], [LOCKED])
        self.patient.refresh_from_db()
        self.assertEqual(self.patient.email, "patient@example.com")
        self.assertEqual(self.patient.mobile_phone_number, "+41791234567")
        self.assertEqual(self.patient.communication_method, "email")
        self.assertFalse(self.patient.temporary)

    def test_fhir_cannot_change_contact_details(self):
        response = self.fhir(
            "put",
            reverse("fhir-patient-item", args=[self.patient.pk]),
            self.patient_resource(self.patient, ATTACKER_EMAIL),
        )
        self.assertEqual(response.status_code, 400, response.data)
        self.assertEqual(response.data["resourceType"], "OperationOutcome")
        self.patient.refresh_from_db()
        self.assertEqual(self.patient.email, "patient@example.com")

    def test_unchanged_contact_details_are_accepted(self):
        # The practitioner app sends the whole form back on every save.
        response = self.patch(
            "patient-detail",
            {
                "email": "Patient@Example.com",
                "mobile_phone_number": "+41 79 123 45 67",
                "communication_method": "email",
                "temporary": False,
                "first_name": "Johnny",
            },
        )
        self.assertEqual(response.status_code, 200, response.data)
        self.patient.refresh_from_db()
        self.assertEqual(self.patient.first_name, "Johnny")
        self.assertEqual(self.patient.mobile_phone_number, "+41791234567")

    def test_fhir_update_without_contact_change_is_accepted(self):
        response = self.fhir(
            "put",
            reverse("fhir-patient-item", args=[self.patient.pk]),
            self.patient_resource(self.patient, "patient@example.com"),
        )
        self.assertEqual(response.status_code, 200, response.data)
        self.patient.refresh_from_db()
        self.assertEqual(self.patient.last_name, "Doe")

    def test_every_way_of_claiming_an_account_locks_it(self):
        claims = {
            "verified email": {"email_verified": True},
            "onboarding done": {"is_first_login": False},
            "signed in": {"last_login": timezone.now()},
        }
        for claim, fields in claims.items():
            with self.subTest(claim=claim):
                user = User.objects.create_user(
                    email=f"{claim.replace(' ', '-')}@example.com", **fields
                )
                response = self.patch("patient-detail", {"email": ATTACKER_EMAIL}, user)
                self.assertEqual(response.status_code, 400, response.data)
        with self.subTest(claim="password set"):
            user = User.objects.create_user(
                email="password@example.com", password="a-patient-password"
            )
            response = self.patch("patient-detail", {"email": ATTACKER_EMAIL}, user)
            self.assertEqual(response.status_code, 400, response.data)

    def test_claim_cannot_be_undone_by_a_third_party(self):
        claims = {
            "onboarding done": ({"is_first_login": False}, {"is_first_login": True}),
            "signed in": ({"last_login": timezone.now()}, {"last_login": None}),
        }
        for claim, (fields, reset) in claims.items():
            with self.subTest(claim=claim):
                user = User.objects.create_user(
                    email=f"{claim.replace(' ', '-')}@example.com", **fields
                )
                response = self.patch("patient-detail", reset, user)
                self.assertEqual(response.status_code, 200, response.data)
                user.refresh_from_db()
                self.assertTrue(user.is_claimed)
                response = self.patch("patient-detail", {"email": ATTACKER_EMAIL}, user)
                self.assertEqual(response.status_code, 400, response.data)

    def test_a_typo_can_be_fixed_before_the_account_is_claimed(self):
        typo = User.objects.create_user(
            email="patient@exmaple.com", created_by=self.practitioner
        )
        response = self.patch(
            "patient-detail",
            {"email": "patient2@example.com", "mobile_phone_number": "+41791112233"},
            typo,
        )
        self.assertEqual(response.status_code, 200, response.data)
        typo.refresh_from_db()
        self.assertEqual(typo.email, "patient2@example.com")
        self.assertEqual(typo.mobile_phone_number, "+41791112233")


@override_config(patient_visibility="alone", users_visibility="alone")
class VisibilityTests(_AccountTakeoverBase):
    """/api/patients/ and /api/practitioners/ apply the visibility settings
    that /api/users/ applies."""

    def setUp(self):
        super().setUp()
        self.colleague = User.objects.create_user(
            email="colleague@example.com", is_practitioner=True
        )
        self.their_patient = User.objects.create_user(
            email="their-patient@example.com", created_by=self.colleague
        )

    def test_someone_elses_patient_is_out_of_reach(self):
        url = reverse("patient-detail", args=[self.their_patient.pk])
        attempts = {
            "retrieve": lambda: self.client.get(url),
            "patch": lambda: self.client.patch(url, {"first_name": "X"}, format="json"),
            "delete": lambda: self.client.delete(url),
            "access url": lambda: self.client.post(
                reverse("patient-access-url", args=[self.their_patient.pk])
            ),
            "fhir read": lambda: self.fhir(
                "get", reverse("fhir-patient-item", args=[self.their_patient.pk])
            ),
        }
        for route, attempt in attempts.items():
            with self.subTest(route=route):
                self.assertEqual(attempt().status_code, 404)
        response = self.client.get(reverse("patient-list"))
        ids = [patient["pk"] for patient in response.data["results"]]
        self.assertNotIn(self.their_patient.pk, ids)
        self.their_patient.refresh_from_db()
        self.assertTrue(self.their_patient.is_active)

    def test_fhir_create_does_not_update_someone_elses_patient(self):
        response = self.fhir(
            "post",
            reverse("fhir-patient-collection"),
            self.patient_resource(self.their_patient, ATTACKER_EMAIL, upsert=True),
        )
        self.assertEqual(response.status_code, 403, response.data)
        self.their_patient.refresh_from_db()
        self.assertEqual(self.their_patient.email, "their-patient@example.com")
        self.assertFalse(User.objects.filter(email=ATTACKER_EMAIL).exists())

    def test_created_patient_stays_visible_to_its_creator(self):
        response = self.client.post(
            reverse("patient-list"),
            {"email": "new@example.com", "first_name": "New"},
            format="json",
        )
        self.assertEqual(response.status_code, 201, response.data)
        created = User.objects.get(email="new@example.com")
        self.assertEqual(created.created_by, self.practitioner)
        response = self.client.get(reverse("patient-detail", args=[created.pk]))
        self.assertEqual(response.status_code, 200)

    def test_practitioners_follow_users_visibility(self):
        response = self.client.get(reverse("practitioner-list"))
        ids = [practitioner["pk"] for practitioner in response.data["results"]]
        self.assertEqual(ids, [self.practitioner.pk])
