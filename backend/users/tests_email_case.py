"""Regression tests: an email address must identify one account, whatever its case.

`User.email` is unique, but that uniqueness is case-sensitive in PostgreSQL while
every authentication path looks the address up case-insensitively. A contact
added as "John@x.org" next to an existing "john@x.org" therefore used to create a
second account, and both accounts then broke login with MultipleObjectsReturned.
"""

from contextlib import contextmanager
from importlib import import_module

from django.apps import apps
from django.db import IntegrityError, connection, transaction
from django.urls import reverse
from django_tenants.test.cases import TenantTestCase
from rest_framework.test import APIClient

from consultations.fhir_participants import (
    get_or_create_patient_user,
    resolve_practitioner_user,
)
from consultations.serializers import ParticipantSerializer
from users.models import User

CASE_INSENSITIVE_CONSTRAINT = "user_email_case_insensitive_unique"


@contextmanager
def legacy_duplicates_allowed():
    """Drop the case-insensitive unique index for the rest of the test.

    Databases upgraded from before that constraint can still hold duplicates,
    and resolution must stay deterministic for them instead of raising
    MultipleObjectsReturned.

    The index is not restored here: PostgreSQL refuses to rebuild it in a
    transaction that already touched the table ("pending trigger events"), and
    TenantTestCase rolls the whole test back anyway — DDL included.
    """
    constraint = next(
        c for c in User._meta.constraints if c.name == CASE_INSENSITIVE_CONSTRAINT
    )
    with connection.schema_editor(atomic=False) as editor:
        editor.remove_constraint(User, constraint)
    yield


class FindByEmailTests(TenantTestCase):
    def setUp(self):
        self.user = User.objects.create_user(
            email="eugene.paik@toronto.msf.org",
            first_name="Eugene",
            last_name="Paik",
        )

    def test_matches_regardless_of_case(self):
        self.assertEqual(
            User.objects.find_by_email("Eugene.Paik@Toronto.MSF.org"), self.user
        )

    def test_ignores_surrounding_whitespace(self):
        self.assertEqual(
            User.objects.find_by_email("  eugene.paik@toronto.msf.org  "), self.user
        )

    def test_returns_none_for_unknown_address(self):
        self.assertIsNone(User.objects.find_by_email("nobody@toronto.msf.org"))

    def test_returns_none_for_empty_address(self):
        self.assertIsNone(User.objects.find_by_email(""))
        self.assertIsNone(User.objects.find_by_email(None))

    def test_prefers_the_active_account_when_duplicates_exist(self):
        with legacy_duplicates_allowed():
            duplicate = User.objects.create_user(
                email="Eugene.Paik@toronto.msf.org", is_active=False
            )
            self.assertEqual(
                User.objects.find_by_email("eugene.paik@toronto.msf.org"), self.user
            )
            self.assertNotEqual(
                User.objects.find_by_email("eugene.paik@toronto.msf.org"), duplicate
            )

    def test_database_rejects_a_new_duplicate(self):
        with self.assertRaises(IntegrityError), transaction.atomic():
            User.objects.create_user(email="EUGENE.PAIK@Toronto.MSF.org")

    def test_get_or_create_by_email_reuses_the_existing_account(self):
        user, created = User.objects.get_or_create_by_email(
            "EUGENE.PAIK@toronto.msf.org", defaults={"first_name": "Other"}
        )
        self.assertFalse(created)
        self.assertEqual(user, self.user)
        # Defaults must not overwrite the existing account.
        self.assertEqual(user.first_name, "Eugene")

    def test_get_or_create_by_email_creates_when_unknown(self):
        user, created = User.objects.get_or_create_by_email(
            "New.Contact@toronto.msf.org", defaults={"first_name": "New"}
        )
        self.assertTrue(created)
        self.assertEqual(user.first_name, "New")
        self.assertEqual(User.objects.filter(first_name="New").count(), 1)


class MigrationGuardTests(TenantTestCase):
    """The migration adding the constraint must name every offending address."""

    def test_guard_lists_the_duplicates_it_refuses_to_migrate(self):
        migration = import_module(
            "users.migrations.0048_user_user_email_case_insensitive_unique"
        )

        with legacy_duplicates_allowed():
            first = User.objects.create_user(email="eugene.paik@toronto.msf.org")
            second = User.objects.create_user(email="Eugene.Paik@toronto.msf.org")

            with connection.schema_editor(atomic=False) as editor:
                with self.assertRaises(RuntimeError) as raised:
                    migration.check_no_case_insensitive_duplicates(apps, editor)

        message = str(raised.exception)
        self.assertIn("eugene.paik@toronto.msf.org", message)
        self.assertIn(str(first.pk), message)
        self.assertIn(str(second.pk), message)

    def test_guard_passes_without_duplicates(self):
        migration = import_module(
            "users.migrations.0048_user_user_email_case_insensitive_unique"
        )

        User.objects.create_user(email="eugene.paik@toronto.msf.org")
        with connection.schema_editor(atomic=False) as editor:
            migration.check_no_case_insensitive_duplicates(apps, editor)


class ParticipantResolutionTests(TenantTestCase):
    def setUp(self):
        self.practitioner = User.objects.create_user(
            email="doc@toronto.msf.org", is_practitioner=True
        )
        self.patient = User.objects.create_user(
            email="eugene.paik@toronto.msf.org",
            first_name="Eugene",
            last_name="Paik",
        )

    def test_resolve_user_maps_a_different_case_to_the_existing_account(self):
        resolved = ParticipantSerializer.resolve_user(
            {
                "email": "Eugene.Paik@Toronto.MSF.org",
                "first_name": "Eugene",
                "last_name": "Paik",
                "communication_method": "email",
            },
            self.practitioner,
        )
        self.assertEqual(resolved, self.patient)
        self.assertEqual(User.objects.filter(email__iexact=self.patient.email).count(), 1)

    def test_resolve_user_still_creates_unknown_contacts(self):
        resolved = ParticipantSerializer.resolve_user(
            {
                "email": "New.Contact@toronto.msf.org",
                "first_name": "New",
                "last_name": "Contact",
                "communication_method": "email",
            },
            self.practitioner,
        )
        self.assertNotEqual(resolved, self.patient)
        self.assertTrue(resolved.temporary)

    def test_fhir_patient_resolution_is_case_insensitive(self):
        user = get_or_create_patient_user(
            email="EUGENE.PAIK@toronto.msf.org",
            first_name="Eugene",
            created_by=self.practitioner,
        )
        self.assertEqual(user, self.patient)

    def test_fhir_practitioner_resolution_is_case_insensitive(self):
        self.assertEqual(
            resolve_practitioner_user(email="Doc@Toronto.MSF.org"), self.practitioner
        )


class PatientCreationEndpointTests(TenantTestCase):
    def setUp(self):
        self.practitioner = User.objects.create_user(
            email="doc@toronto.msf.org", is_practitioner=True
        )
        self.client = APIClient()
        self.client.force_authenticate(user=self.practitioner)

    def test_creating_a_patient_rejects_an_address_already_taken_in_another_case(self):
        # Same answer as an exact duplicate (400), instead of silently creating a
        # second account for the same person.
        User.objects.create_user(email="eugene.paik@toronto.msf.org")

        response = self.client.post(
            reverse("patient-list"),
            data={
                "email": "Eugene.Paik@Toronto.MSF.org",
                "first_name": "Eugene",
                "last_name": "Paik",
            },
            format="json",
        )

        self.assertEqual(response.status_code, 400, response.data)
        self.assertIn("email", response.data)
        self.assertEqual(
            User.objects.filter(email__iexact="eugene.paik@toronto.msf.org").count(), 1
        )

    def test_creating_a_patient_with_a_new_address_still_works(self):
        response = self.client.post(
            reverse("patient-list"),
            data={
                "email": "new.patient@toronto.msf.org",
                "first_name": "New",
                "last_name": "Patient",
            },
            format="json",
        )

        self.assertEqual(response.status_code, 201, response.data)


class VerificationCodeTests(TenantTestCase):
    def test_duplicated_accounts_do_not_break_the_verification_code(self):
        # Reproduces the 500 seen in production on a database that already held
        # two accounts for the same address.
        with legacy_duplicates_allowed():
            User.objects.create_user(
                email="eugene.paik@toronto.msf.org", is_active=False
            )
            active = User.objects.create_user(email="Eugene.Paik@toronto.msf.org")

            response = APIClient().post(
                "/api/auth/send-verification-code/",
                data={"email": "eugene.paik@TORONTO.msf.org"},
                format="json",
            )

            self.assertEqual(response.status_code, 200, response.data)
            active.refresh_from_db()
            self.assertIsNotNone(active.verification_code)
