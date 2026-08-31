from datetime import timedelta

from constance.test import override_config
from django.urls import reverse
from django.utils import timezone
from django_tenants.test.cases import TenantTestCase
from rest_framework.test import APIClient

from consultations.models import (
    Appointment,
    Consultation,
    Participant,
    Request,
    RequestStatus,
)
from users.models import User


# Pinned so an appointment with no explicit end stays active for 30 + 15 = 45
# minutes after its start.
@override_config(
    default_appointment_duration_in_minutes=30,
    call_limit_join_minutes=15,
)
class PatientDashboardClosedFollowUpTests(TenantTestCase):
    """A closed follow-up takes its appointments off the patient dashboard.

    Closing a consultation ends the whole case: its upcoming appointments must
    stop showing up, be it as the highlighted next appointment, as an orphan
    appointment card, or through the request that opened the follow-up.
    """

    def setUp(self):
        self.practitioner = User.objects.create_user(
            email="doc@example.com", is_practitioner=True
        )
        self.patient = User.objects.create_user(email="patient@example.com")
        self.client = APIClient()
        self.client.force_authenticate(user=self.patient)

    def _appointment(self, consultation=None):
        appointment = Appointment.objects.create(
            created_by=self.practitioner,
            consultation=consultation,
            scheduled_at=timezone.now() + timedelta(hours=2),
        )
        Participant.objects.create(appointment=appointment, user=self.patient)
        return appointment

    def _dashboard(self):
        response = self.client.get(reverse("user_dashboard"))
        self.assertEqual(response.status_code, 200)
        return response.data

    def test_appointment_of_an_open_consultation_is_listed(self):
        consultation = Consultation.objects.create(
            created_by=self.practitioner, beneficiary=self.patient
        )
        appointment = self._appointment(consultation)

        data = self._dashboard()

        self.assertEqual(data["next_appointment"]["id"], appointment.pk)
        self.assertEqual(
            [row["id"] for row in data["consultations"]], [consultation.pk]
        )

    def test_appointment_of_a_closed_consultation_is_hidden(self):
        consultation = Consultation.objects.create(
            created_by=self.practitioner,
            beneficiary=self.patient,
            closed_at=timezone.now(),
        )
        self._appointment(consultation)

        data = self._dashboard()

        self.assertIsNone(data["next_appointment"])
        self.assertEqual(data["consultations"], [])
        self.assertEqual(data["appointments"], [])

    def test_appointment_without_consultation_stays_listed(self):
        appointment = self._appointment()

        data = self._dashboard()

        self.assertEqual(data["next_appointment"]["id"], appointment.pk)
        self.assertEqual([row["id"] for row in data["appointments"]], [appointment.pk])

    def test_request_of_a_closed_consultation_is_hidden(self):
        consultation = Consultation.objects.create(
            created_by=self.practitioner,
            beneficiary=self.patient,
            closed_at=timezone.now(),
        )
        appointment = self._appointment(consultation)
        Request.objects.create(
            created_by=self.patient,
            status=RequestStatus.accepted,
            consultation=consultation,
            appointment=appointment,
        )

        data = self._dashboard()

        self.assertEqual(data["requests"], [])
        self.assertEqual(data["appointments"], [])
        self.assertIsNone(data["next_appointment"])

    def test_request_of_an_open_consultation_is_listed(self):
        consultation = Consultation.objects.create(
            created_by=self.practitioner, beneficiary=self.patient
        )
        appointment = self._appointment(consultation)
        request = Request.objects.create(
            created_by=self.patient,
            status=RequestStatus.accepted,
            consultation=consultation,
            appointment=appointment,
        )

        data = self._dashboard()

        self.assertEqual([row["id"] for row in data["requests"]], [request.pk])
