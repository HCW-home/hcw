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
        other_patient = User.objects.create_user(email="other@example.com")
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
        # Participants are embedded as contained resources, referenced locally.
        self.assertEqual(data["participant"][0]["actor"]["reference"], "#patient")

    def test_round_trip(self):
        mapper = AppointmentFhirMapper()
        data = mapper.to_fhir(self.appointment)

        class _Req:
            user = self.practitioner
        instance = mapper.from_fhir(data, instance=Appointment(pk=None, created_by=self.practitioner),
                                    context={"request": _Req()})
        self.assertEqual(instance.status, AppointmentStatus.scheduled)


class AppointmentFhirStatusDerivationTests(_AppointmentFhirBase):
    """FHIR Appointment.status reflects participant confirmations (per spec):
    proposed = none confirmed, pending = some confirmed, booked = all confirmed."""

    def _status_of(self, appt):
        return AppointmentFhirMapper().to_fhir(appt)["status"]

    def _make_appt(self, confirmations):
        appt = Appointment.objects.create(
            created_by=self.practitioner,
            scheduled_at=timezone.now() + timedelta(days=2),
            status=AppointmentStatus.scheduled,
        )
        for i, confirmed in enumerate(confirmations):
            user = User.objects.create_user(email=f"p{i}@ex.com")
            Participant.objects.create(
                appointment=appt, user=user, is_confirmed=confirmed, is_active=True,
            )
        return appt

    def test_all_confirmed_is_booked(self):
        appt = self._make_appt([True, True])
        self.assertEqual(self._status_of(appt), "booked")

    def test_some_confirmed_is_pending(self):
        appt = self._make_appt([True, None])
        self.assertEqual(self._status_of(appt), "pending")

    def test_none_confirmed_is_proposed(self):
        appt = self._make_appt([None, None])
        self.assertEqual(self._status_of(appt), "proposed")

    def test_declined_without_any_accepted_is_proposed(self):
        # No is_confirmed=True anywhere -> proposed.
        appt = self._make_appt([False, None])
        self.assertEqual(self._status_of(appt), "proposed")

    def test_declined_with_one_accepted_is_pending(self):
        appt = self._make_appt([True, False])
        self.assertEqual(self._status_of(appt), "pending")

    def test_no_active_participants_is_proposed(self):
        appt = Appointment.objects.create(
            created_by=self.practitioner,
            scheduled_at=timezone.now() + timedelta(days=2),
            status=AppointmentStatus.scheduled,
        )
        self.assertEqual(self._status_of(appt), "proposed")

    def test_inactive_confirmed_participant_ignored(self):
        # An inactive (cancelled) participant must not count toward "all confirmed".
        appt = self._make_appt([None])
        gone = User.objects.create_user(email="gone@ex.com")
        Participant.objects.create(
            appointment=appt, user=gone, is_confirmed=True, is_active=False,
        )
        self.assertEqual(self._status_of(appt), "proposed")

    def test_cancelled_appointment_is_cancelled(self):
        appt = self._make_appt([True, True])
        appt.status = AppointmentStatus.cancelled
        appt.save(update_fields=["status"])
        self.assertEqual(self._status_of(appt), "cancelled")

    def test_draft_appointment_is_proposed(self):
        appt = self._make_appt([True])
        appt.status = AppointmentStatus.draft
        appt.save(update_fields=["status"])
        self.assertEqual(self._status_of(appt), "proposed")


class AppointmentContainedParticipantTests(_AppointmentFhirBase):
    """FHIR clients inline Patient/Practitioner in `contained` and reference
    them via `#fragment`. Patients are find-or-created; practitioners must
    already exist (never created via FHIR)."""

    def _fhir_post(self, payload):
        return self.client.post(
            reverse("appointment-list"),
            data=json.dumps(payload),
            content_type="application/fhir+json",
            HTTP_ACCEPT="application/fhir+json",
        )

    def _payload(self, *, contained, participants, status="proposed"):
        return {
            "resourceType": "Appointment",
            "status": status,
            "start": (timezone.now() + timedelta(days=3)).isoformat(),
            "end": (timezone.now() + timedelta(days=3, minutes=30)).isoformat(),
            "contained": contained,
            "participant": participants,
        }

    _PATIENT_CONTAINED = {
        "resourceType": "Patient", "id": "patient",
        "name": [{"family": "John", "given": ["Doe"]}],
        "telecom": [{"system": "email", "value": "jdoe@ozone.com"}],
        "gender": "male",
    }
    _PRACTITIONER_CONTAINED = {
        "resourceType": "Practitioner", "id": "practitioner",
        "telecom": [{"system": "email", "value": "doc@ozone.com", "use": "work"}],
    }
    _PARTICIPANTS = [
        {"status": "needs-action", "actor": {"reference": "#patient"}},
        {"status": "needs-action", "actor": {"reference": "#practitioner"}},
    ]

    def test_contained_patient_created_and_linked(self):
        # Practitioner must pre-exist (lookup-only).
        User.objects.create_user(
            email="doc@ozone.com", is_practitioner=True,
        )
        response = self._fhir_post(self._payload(
            contained=[self._PATIENT_CONTAINED, self._PRACTITIONER_CONTAINED],
            participants=self._PARTICIPANTS,
        ))
        self.assertEqual(response.status_code, 201, response.data)
        created_patient = User.objects.get(email="jdoe@ozone.com")
        self.assertFalse(created_patient.is_practitioner)
        self.assertTrue(created_patient.temporary)
        self.assertEqual(created_patient.first_name, "Doe")
        self.assertEqual(created_patient.last_name, "John")
        appt = Appointment.objects.get(pk=response.data["id"])
        self.assertTrue(
            Participant.objects.filter(
                appointment=appt, user=created_patient, is_active=True,
            ).exists()
        )

    def test_contained_patient_matched_by_email_no_duplicate(self):
        existing = User.objects.create_user(email="jdoe@ozone.com")
        User.objects.create_user(
            email="doc@ozone.com", is_practitioner=True,
        )
        response = self._fhir_post(self._payload(
            contained=[self._PATIENT_CONTAINED, self._PRACTITIONER_CONTAINED],
            participants=self._PARTICIPANTS,
        ))
        self.assertEqual(response.status_code, 201, response.data)
        self.assertEqual(User.objects.filter(email="jdoe@ozone.com").count(), 1)
        appt = Appointment.objects.get(pk=response.data["id"])
        self.assertTrue(
            Participant.objects.filter(appointment=appt, user=existing).exists()
        )

    def test_contained_practitioner_matched_no_creation(self):
        doc = User.objects.create_user(
            email="doc@ozone.com", is_practitioner=True,
        )
        response = self._fhir_post(self._payload(
            contained=[self._PATIENT_CONTAINED, self._PRACTITIONER_CONTAINED],
            participants=self._PARTICIPANTS,
        ))
        self.assertEqual(response.status_code, 201, response.data)
        # No second practitioner created.
        self.assertEqual(
            User.objects.filter(email="doc@ozone.com").count(), 1,
        )
        appt = Appointment.objects.get(pk=response.data["id"])
        self.assertTrue(Participant.objects.filter(appointment=appt, user=doc).exists())

    def test_contained_practitioner_not_found_errors_and_rolls_back(self):
        appt_count = Appointment.objects.count()
        response = self._fhir_post(self._payload(
            contained=[self._PATIENT_CONTAINED, self._PRACTITIONER_CONTAINED],
            participants=self._PARTICIPANTS,
        ))
        self.assertEqual(response.status_code, 422, response.data)
        self.assertEqual(response.data["resourceType"], "OperationOutcome")
        # Rollback: neither the appointment nor the contained patient persisted.
        self.assertEqual(Appointment.objects.count(), appt_count)
        self.assertFalse(User.objects.filter(email="jdoe@ozone.com").exists())

    def test_mixed_contained_and_pk_reference(self):
        doc = User.objects.create_user(
            email="doc2@ozone.com", is_practitioner=True,
        )
        response = self._fhir_post(self._payload(
            contained=[self._PATIENT_CONTAINED],
            participants=[
                {"status": "needs-action", "actor": {"reference": "#patient"}},
                {"status": "accepted", "actor": {"reference": f"Practitioner/{doc.pk}"}},
            ],
        ))
        self.assertEqual(response.status_code, 201, response.data)
        appt = Appointment.objects.get(pk=response.data["id"])
        created_patient = User.objects.get(email="jdoe@ozone.com")
        self.assertEqual(
            set(appt.participant_set.filter(is_active=True).values_list("user_id", flat=True)),
            {created_patient.pk, doc.pk},
        )

    def test_contained_anonymous_patient_created(self):
        anon = {"resourceType": "Patient", "id": "patient",
                "name": [{"family": "NoContact"}]}
        response = self._fhir_post(self._payload(
            contained=[anon],
            participants=[{"status": "needs-action", "actor": {"reference": "#patient"}}],
        ))
        self.assertEqual(response.status_code, 201, response.data)
        appt = Appointment.objects.get(pk=response.data["id"])
        self.assertEqual(appt.participant_set.filter(is_active=True).count(), 1)
        part = appt.participant_set.filter(is_active=True).first()
        self.assertTrue(part.user.temporary)

    def test_missing_contained_fragment_errors(self):
        response = self._fhir_post(self._payload(
            contained=[],  # #patient referenced but not provided
            participants=[{"status": "needs-action", "actor": {"reference": "#patient"}}],
        ))
        self.assertEqual(response.status_code, 404, response.data)
        self.assertEqual(response.data["resourceType"], "OperationOutcome")


class AppointmentOutboundContainedTests(_AppointmentFhirBase):
    """Serialising an Appointment embeds each participant as a `contained`
    Patient/Practitioner and points `actor.reference` at its `#fragment`."""

    def _to_fhir(self):
        return AppointmentFhirMapper().to_fhir(self.appointment)

    @staticmethod
    def _frag(participant):
        return participant["actor"]["reference"]

    def test_single_patient_contained_and_referenced(self):
        data = self._to_fhir()
        FhirAppointment.model_validate(data)
        self.assertEqual(len(data["contained"]), 1)
        patient = data["contained"][0]
        self.assertEqual(patient["resourceType"], "Patient")
        self.assertEqual(patient["id"], "patient")
        self.assertNotIn("meta", patient)
        # Canonical Patient/<pk> identifier is preserved for dereferencing.
        self.assertTrue(
            any(i.get("value") == str(self.patient.pk) for i in patient["identifier"])
        )
        actor = data["participant"][0]["actor"]
        self.assertEqual(actor["reference"], "#patient")
        self.assertTrue(actor.get("display"))

    def test_practitioner_participant_contained(self):
        Participant.objects.create(
            appointment=self.appointment, user=self.practitioner, is_confirmed=True,
        )
        data = self._to_fhir()
        types = {c["resourceType"]: c for c in data["contained"]}
        self.assertIn("Practitioner", types)
        self.assertEqual(types["Practitioner"]["id"], "practitioner")
        refs = {self._frag(p) for p in data["participant"]}
        self.assertIn("#practitioner", refs)

    def test_multiple_practitioners_get_indexed_fragments(self):
        doc2 = User.objects.create_user(email="doc2@example.com", is_practitioner=True)
        Participant.objects.create(appointment=self.appointment, user=self.practitioner)
        Participant.objects.create(appointment=self.appointment, user=doc2)
        data = self._to_fhir()
        ids = {c["id"] for c in data["contained"]}
        self.assertIn("practitioner", ids)
        self.assertIn("practitioner-1", ids)
        refs = {self._frag(p) for p in data["participant"]}
        self.assertTrue({"#practitioner", "#practitioner-1"} <= refs)

    def test_multiple_patients_get_indexed_fragments(self):
        pat2 = User.objects.create_user(email="pat2@example.com")
        Participant.objects.create(appointment=self.appointment, user=pat2)
        data = self._to_fhir()
        ids = {c["id"] for c in data["contained"]}
        self.assertIn("patient", ids)
        self.assertIn("patient-1", ids)

    def test_round_trip_through_contained(self):
        data = self._to_fhir()

        class _Req:
            user = self.practitioner
        instance = AppointmentFhirMapper().from_fhir(
            data,
            instance=Appointment(pk=None, created_by=self.practitioner),
            context={"request": _Req()},
        )
        self.assertEqual(set(instance._fhir_contained), {"patient"})

    def test_endpoint_retrieve_includes_contained(self):
        url = reverse("appointment-detail", kwargs={"pk": self.appointment.pk})
        response = self.client.get(f"{url}?format=fhir")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["contained"][0]["resourceType"], "Patient")
        self.assertEqual(response.data["participant"][0]["actor"]["reference"], "#patient")
