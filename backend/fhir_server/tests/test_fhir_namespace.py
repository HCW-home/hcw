"""Tests for the `/api/fhir/<ResourceType>` canonical alias namespace.

Covers the forcing mechanism (FHIR without `?format=fhir`), no-trailing-slash
routing, permissions parity, the registry sync guard, and metadata.
"""
from datetime import timedelta

from django.urls import reverse
from django.utils import timezone
from django_tenants.test.cases import TenantTestCase
from rest_framework.test import APIClient

from consultations.models import (
    Appointment,
    AppointmentStatus,
    Consultation,
    Participant,
)
from fhir_server.fhir_routes import get_fhir_viewsets
from fhir_server.registry import get_registry, reset_registry
from users.models import User


class _FhirNamespaceBase(TenantTestCase):

    def setUp(self):
        self.practitioner = User.objects.create_user(
            email="doc@example.com",
            is_practitioner=True,
        )
        self.patient = User.objects.create_user(
            email="pat@example.com",
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


class ForcingTests(_FhirNamespaceBase):

    def test_collection_is_fhir_without_format_param(self):
        # Plain JSON Accept, no ?format=fhir -> still a FHIR Bundle.
        url = reverse("fhir-appointment-collection")
        response = self.client.get(url, HTTP_ACCEPT="application/json")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(
            response["Content-Type"].split(";")[0], "application/fhir+json"
        )
        self.assertEqual(response.data["resourceType"], "Bundle")
        self.assertEqual(response.data["type"], "searchset")

    def test_native_route_still_returns_plain_json(self):
        # The forced negotiation must not leak onto the shared ViewSet class.
        url = reverse("appointment-list")
        response = self.client.get(url, HTTP_ACCEPT="application/json")
        self.assertEqual(response.status_code, 200)
        self.assertNotIn("application/fhir+json", response["Content-Type"])
        self.assertNotIn("resourceType", response.data)

    def test_item_route_returns_single_resource(self):
        url = reverse(
            "fhir-appointment-item", kwargs={"pk": self.appointment.pk}
        )
        response = self.client.get(url)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["resourceType"], "Appointment")

    def test_no_trailing_slash_is_not_redirected(self):
        # Route declared without a slash -> no APPEND_SLASH 301.
        url = reverse("fhir-appointment-collection")
        self.assertFalse(url.endswith("/"))
        response = self.client.get(url)
        self.assertEqual(response.status_code, 200)


class PermissionsTests(_FhirNamespaceBase):

    def test_unauthenticated_yields_operation_outcome(self):
        client = APIClient()  # no auth
        url = reverse("fhir-patient-collection")
        response = client.get(url)
        self.assertIn(response.status_code, (401, 403))
        # FHIR exception handler runs because the request is forced to FHIR.
        self.assertEqual(response.data.get("resourceType"), "OperationOutcome")


class SyncGuardTests(TenantTestCase):

    def test_every_registered_resource_has_an_alias(self):
        reset_registry()
        registered = set(get_registry().keys())
        aliased = set(get_fhir_viewsets().keys())
        missing = registered - aliased
        self.assertEqual(
            missing,
            set(),
            f"FHIR resource types without an /api/fhir alias: {missing}",
        )


class MetadataTests(_FhirNamespaceBase):

    def test_metadata_returns_capability_statement(self):
        url = reverse("fhir-metadata")
        response = self.client.get(url)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["resourceType"], "CapabilityStatement")
