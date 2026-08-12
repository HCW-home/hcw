from datetime import timedelta
from unittest.mock import MagicMock, patch

from constance.test import override_config
from django.urls import reverse
from django.utils import timezone
from django_tenants.test.cases import TenantTestCase
from rest_framework.test import APIClient

from consultations.models import (
    Appointment,
    AppointmentStatus,
    Consultation,
    Participant,
    ParticipantStatus,
    Type,
)
from consultations.tasks import resolve_appointment_outcomes
from users.models import User


def _mocked_server():
    """Stand-in for a reachable media server pinned to the room."""
    server = MagicMock()
    server.instance.appointment_participant_info.return_value = {
        "provider": "livekit",
        "url": "wss://example.test",
        "token": "jwt",
        "room": "room",
    }
    return server


class _OutcomeBase(TenantTestCase):
    def setUp(self):
        self.practitioner = User.objects.create_user(
            email="doc@example.com", is_practitioner=True
        )
        self.patient = User.objects.create_user(email="pat@example.com")
        self.consultation = Consultation.objects.create(
            title="Follow-up",
            created_by=self.practitioner,
            beneficiary=self.patient,
        )
        self.client = APIClient()
        self.client.force_authenticate(user=self.practitioner)

    def _appointment(self, *, when=None, appointment_type=Type.online, **overrides):
        """An appointment with both users on the roster."""
        appointment = Appointment.objects.create(
            created_by=self.practitioner,
            consultation=self.consultation,
            scheduled_at=when or (timezone.now() + timedelta(minutes=5)),
            type=appointment_type,
            **overrides,
        )
        self.doc_participant = Participant.objects.create(
            appointment=appointment, user=self.practitioner
        )
        self.patient_participant = Participant.objects.create(
            appointment=appointment, user=self.patient
        )
        return appointment

    def _past(self, minutes=120):
        return timezone.now() - timedelta(minutes=minutes)


class ArrivalRecordingTests(_OutcomeBase):
    """Joining a call is what flags a participant as arrived."""

    def test_practitioner_join_records_arrival(self):
        appointment = self._appointment()
        url = reverse("appointment-join", kwargs={"pk": appointment.pk})

        with patch(
            "consultations.views.Server.get_or_pin_for_room",
            return_value=_mocked_server(),
        ):
            response = self.client.get(url)

        self.assertEqual(response.status_code, 200, response.data)
        self.doc_participant.refresh_from_db()
        self.assertIsNotNone(self.doc_participant.arrived_at)
        self.patient_participant.refresh_from_db()
        self.assertIsNone(self.patient_participant.arrived_at)

    def test_patient_join_records_arrival(self):
        """The patient app hits its own endpoint; it must record too."""
        appointment = self._appointment()
        patient_client = APIClient()
        patient_client.force_authenticate(user=self.patient)
        url = reverse("user-appointments-join", kwargs={"pk": appointment.pk})

        with patch(
            "users.views.Server.get_or_pin_for_room", return_value=_mocked_server()
        ):
            response = patient_client.get(url)

        self.assertEqual(response.status_code, 200, response.data)
        self.patient_participant.refresh_from_db()
        self.assertIsNotNone(self.patient_participant.arrived_at)

    def test_second_join_keeps_first_arrival(self):
        appointment = self._appointment()
        url = reverse("appointment-join", kwargs={"pk": appointment.pk})

        with patch(
            "consultations.views.Server.get_or_pin_for_room",
            return_value=_mocked_server(),
        ):
            self.client.get(url)
            self.doc_participant.refresh_from_db()
            first = self.doc_participant.arrived_at
            self.client.get(url)

        self.doc_participant.refresh_from_db()
        self.assertEqual(self.doc_participant.arrived_at, first)

    def test_non_participant_cannot_join(self):
        appointment = self._appointment()
        self.doc_participant.delete()
        url = reverse("appointment-join", kwargs={"pk": appointment.pk})

        with patch(
            "consultations.views.Server.get_or_pin_for_room",
            return_value=_mocked_server(),
        ):
            response = self.client.get(url)

        self.assertEqual(response.status_code, 403)
        self.assertEqual(response.data["code"], "not_participant")
        self.patient_participant.refresh_from_db()
        self.assertIsNone(self.patient_participant.arrived_at)


class ParticipantStatusTests(_OutcomeBase):
    def test_arrived_outranks_confirmed(self):
        self._appointment()
        self.doc_participant.is_confirmed = True
        self.doc_participant.arrived_at = timezone.now()
        self.assertEqual(self.doc_participant.status, ParticipantStatus.arrived.value)

    def test_cancelled_outranks_arrived(self):
        self._appointment()
        self.doc_participant.arrived_at = timezone.now()
        self.doc_participant.is_active = False
        self.assertEqual(self.doc_participant.status, ParticipantStatus.cancelled.value)

    def test_confirmed_without_arrival_unchanged(self):
        self._appointment()
        self.doc_participant.is_confirmed = True
        self.assertEqual(self.doc_participant.status, ParticipantStatus.confirmed.value)


@override_config(enable_appointment_outcome_detection=True)
class ResolveOutcomesTaskTests(_OutcomeBase):
    def test_two_arrivals_complete_the_appointment(self):
        appointment = self._appointment(when=self._past())
        now = timezone.now()
        Participant.objects.filter(appointment=appointment).update(arrived_at=now)

        resolve_appointment_outcomes()

        appointment.refresh_from_db()
        self.assertEqual(appointment.status, AppointmentStatus.completed)

    def test_single_arrival_is_a_noshow(self):
        appointment = self._appointment(when=self._past())
        self.doc_participant.arrived_at = timezone.now()
        self.doc_participant.save(update_fields=["arrived_at"])

        resolve_appointment_outcomes()

        appointment.refresh_from_db()
        self.assertEqual(appointment.status, AppointmentStatus.noshow)

    def test_no_arrival_is_a_noshow(self):
        appointment = self._appointment(when=self._past())

        resolve_appointment_outcomes()

        appointment.refresh_from_db()
        self.assertEqual(appointment.status, AppointmentStatus.noshow)

    def test_lone_participant_who_arrived_completes(self):
        """The threshold falls back to the roster size."""
        appointment = self._appointment(when=self._past())
        self.patient_participant.delete()
        self.doc_participant.arrived_at = timezone.now()
        self.doc_participant.save(update_fields=["arrived_at"])

        resolve_appointment_outcomes()

        appointment.refresh_from_db()
        self.assertEqual(appointment.status, AppointmentStatus.completed)

    def test_still_within_join_window_is_untouched(self):
        # Ends in 25 min, so the join window is nowhere near closed.
        appointment = self._appointment(when=timezone.now() - timedelta(minutes=5))

        resolve_appointment_outcomes()

        appointment.refresh_from_db()
        self.assertEqual(appointment.status, AppointmentStatus.scheduled)

    def test_far_end_expected_at_defers_the_decision(self):
        appointment = self._appointment(
            when=self._past(minutes=600),
            end_expected_at=timezone.now() + timedelta(hours=2),
        )

        resolve_appointment_outcomes()

        appointment.refresh_from_db()
        self.assertEqual(appointment.status, AppointmentStatus.scheduled)

    def test_in_person_is_never_touched(self):
        appointment = self._appointment(
            when=self._past(), appointment_type=Type.inperson
        )

        resolve_appointment_outcomes()

        appointment.refresh_from_db()
        self.assertEqual(appointment.status, AppointmentStatus.scheduled)

    def test_non_scheduled_statuses_are_never_touched(self):
        for initial in [
            AppointmentStatus.draft,
            AppointmentStatus.cancelled,
            AppointmentStatus.completed,
            AppointmentStatus.noshow,
        ]:
            with self.subTest(status=initial):
                appointment = self._appointment(when=self._past(), status=initial)

                resolve_appointment_outcomes()

                appointment.refresh_from_db()
                self.assertEqual(appointment.status, initial)

    def test_outside_lookback_window_is_ignored(self):
        appointment = self._appointment(when=timezone.now() - timedelta(days=30))

        resolve_appointment_outcomes()

        appointment.refresh_from_db()
        self.assertEqual(appointment.status, AppointmentStatus.scheduled)

    def test_second_run_is_idempotent(self):
        appointment = self._appointment(when=self._past())

        resolve_appointment_outcomes()
        appointment.refresh_from_db()
        first_update = appointment.updated_at

        resolve_appointment_outcomes()
        appointment.refresh_from_db()
        self.assertEqual(appointment.status, AppointmentStatus.noshow)
        self.assertEqual(appointment.updated_at, first_update)

    @override_config(enable_appointment_outcome_detection=False)
    def test_disabled_is_a_noop(self):
        appointment = self._appointment(when=self._past())

        resolve_appointment_outcomes()

        appointment.refresh_from_db()
        self.assertEqual(appointment.status, AppointmentStatus.scheduled)


@override_config(enable_appointment_outcome_detection=True)
class SetStatusActionTests(_OutcomeBase):
    def _url(self, appointment):
        return reverse("appointment-set-status", kwargs={"pk": appointment.pk})

    def test_practitioner_sets_completed(self):
        appointment = self._appointment(when=self._past())

        response = self.client.post(
            self._url(appointment), {"status": "completed"}, format="json"
        )

        self.assertEqual(response.status_code, 200, response.data)
        appointment.refresh_from_db()
        self.assertEqual(appointment.status, AppointmentStatus.completed)

    def test_in_person_can_be_qualified_manually(self):
        appointment = self._appointment(
            when=self._past(), appointment_type=Type.inperson
        )

        response = self.client.post(
            self._url(appointment), {"status": "noshow"}, format="json"
        )

        self.assertEqual(response.status_code, 200, response.data)
        appointment.refresh_from_db()
        self.assertEqual(appointment.status, AppointmentStatus.noshow)

    def test_invalid_status_is_rejected(self):
        appointment = self._appointment()

        response = self.client.post(
            self._url(appointment), {"status": "draft"}, format="json"
        )

        self.assertEqual(response.status_code, 400)

    def test_patient_is_forbidden(self):
        appointment = self._appointment()
        patient_client = APIClient()
        patient_client.force_authenticate(user=self.patient)

        response = patient_client.post(
            self._url(appointment), {"status": "completed"}, format="json"
        )

        self.assertEqual(response.status_code, 403)

    def test_practitioner_with_read_only_visibility_cannot_set_status(self):
        """Seeing a colleague's appointment must not allow rewriting its outcome."""
        appointment = self._appointment()
        other = User.objects.create_user(
            email="other@example.com", is_practitioner=True
        )
        Participant.objects.create(appointment=appointment, user=other)
        other_client = APIClient()
        other_client.force_authenticate(user=other)

        response = other_client.post(
            self._url(appointment), {"status": "completed"}, format="json"
        )

        self.assertEqual(response.status_code, 404)

    def test_manual_status_survives_the_task(self):
        appointment = self._appointment(when=self._past())
        self.client.post(
            self._url(appointment), {"status": "completed"}, format="json"
        )

        resolve_appointment_outcomes()

        appointment.refresh_from_db()
        self.assertEqual(appointment.status, AppointmentStatus.completed)


class CanJoinFlagTests(_OutcomeBase):
    def _detail(self, appointment, client=None):
        url = reverse("appointment-detail", kwargs={"pk": appointment.pk})
        return (client or self.client).get(url)

    def test_participant_can_join(self):
        appointment = self._appointment()
        self.assertTrue(self._detail(appointment).data["can_join"])

    def test_non_participant_cannot_join(self):
        appointment = self._appointment()
        self.doc_participant.delete()
        self.assertFalse(self._detail(appointment).data["can_join"])

    def test_in_person_cannot_join(self):
        appointment = self._appointment(appointment_type=Type.inperson)
        self.assertFalse(self._detail(appointment).data["can_join"])

    def test_closed_consultation_cannot_join(self):
        appointment = self._appointment()
        self.consultation.closed_at = timezone.now()
        self.consultation.save(update_fields=["closed_at"])
        self.assertFalse(self._detail(appointment).data["can_join"])
