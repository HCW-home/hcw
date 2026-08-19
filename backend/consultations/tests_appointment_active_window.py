from datetime import timedelta

from constance.test import override_config
from django.urls import reverse
from django.utils import timezone
from django_tenants.test.cases import TenantTestCase
from rest_framework.test import APIClient

from consultations.models import Appointment, Consultation
from consultations.utils import appointment_active_q, is_appointment_active
from users.models import User


# Pinned so the window is exactly 30 + 15 = 45 minutes after the start for an
# appointment with no explicit end, and 15 minutes after an explicit end.
@override_config(
    default_appointment_duration_in_minutes=30,
    call_limit_join_minutes=15,
)
class AppointmentActiveWindowTests(TenantTestCase):
    """When an appointment moves from "upcoming" to "past".

    The switch happens once the appointment is over plus the late-join
    tolerance. "Over" means `end_expected_at` when set, and only otherwise
    `scheduled_at + default_appointment_duration_in_minutes`.
    """

    def setUp(self):
        self.practitioner = User.objects.create_user(
            email="doc@example.com", is_practitioner=True
        )
        self.consultation = Consultation.objects.create(
            title="Follow-up", created_by=self.practitioner
        )
        self.client = APIClient()
        self.client.force_authenticate(user=self.practitioner)

    def _appointment(self, *, starts_ago_minutes, ends_in_minutes=None):
        now = timezone.now()
        return Appointment.objects.create(
            created_by=self.practitioner,
            consultation=self.consultation,
            scheduled_at=now - timedelta(minutes=starts_ago_minutes),
            end_expected_at=(
                now + timedelta(minutes=ends_in_minutes)
                if ends_in_minutes is not None
                else None
            ),
        )

    def _listed(self, future):
        response = self.client.get(
            reverse("appointment-list"),
            {"consultation": self.consultation.pk, "future": future},
        )
        self.assertEqual(response.status_code, 200)
        return {row["id"] for row in response.data["results"]}

    def test_no_end_time_stays_active_inside_the_window(self):
        appointment = self._appointment(starts_ago_minutes=20)

        self.assertIn(appointment.pk, self._listed("true"))
        self.assertNotIn(appointment.pk, self._listed("false"))

    def test_no_end_time_becomes_past_after_duration_plus_join_limit(self):
        appointment = self._appointment(starts_ago_minutes=46)

        self.assertNotIn(appointment.pk, self._listed("true"))
        self.assertIn(appointment.pk, self._listed("false"))

    def test_explicit_end_time_keeps_a_long_appointment_upcoming(self):
        """A three-hour appointment is not "past" 45 minutes in."""
        appointment = self._appointment(starts_ago_minutes=90, ends_in_minutes=90)

        self.assertIn(appointment.pk, self._listed("true"))
        self.assertNotIn(appointment.pk, self._listed("false"))

    def test_explicit_end_time_becomes_past_after_the_join_limit(self):
        appointment = self._appointment(starts_ago_minutes=180, ends_in_minutes=-16)

        self.assertNotIn(appointment.pk, self._listed("true"))
        self.assertIn(appointment.pk, self._listed("false"))

    def test_past_is_the_exact_complement_of_upcoming(self):
        expected = {
            self._appointment(starts_ago_minutes=20).pk,
            self._appointment(starts_ago_minutes=46).pk,
            self._appointment(starts_ago_minutes=90, ends_in_minutes=90).pk,
            self._appointment(starts_ago_minutes=180, ends_in_minutes=-16).pk,
        }
        upcoming = self._listed("true")
        past = self._listed("false")

        self.assertEqual(upcoming | past, expected)
        self.assertEqual(upcoming & past, set())

    def test_instance_helper_matches_the_queryset_filter(self):
        cases = [
            self._appointment(starts_ago_minutes=20),
            self._appointment(starts_ago_minutes=46),
            self._appointment(starts_ago_minutes=90, ends_in_minutes=90),
            self._appointment(starts_ago_minutes=180, ends_in_minutes=-16),
        ]
        active_ids = set(
            Appointment.objects.filter(appointment_active_q()).values_list(
                "pk", flat=True
            )
        )

        for appointment in cases:
            self.assertEqual(
                is_appointment_active(appointment),
                appointment.pk in active_ids,
                msg=f"appointment #{appointment.pk}",
            )
