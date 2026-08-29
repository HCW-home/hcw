"""What a CalDAV subscriber is told about the consultation behind an event.

The calendar is scoped on the appointment roster, which is wider than the
consultation access rule: being invited to one call puts the event in your
calendar, it does not open the medical follow-up behind it.
"""

import base64
from datetime import timedelta

from django.urls import reverse
from django.utils import timezone
from django_tenants.test.cases import TenantTestCase

from consultations.models import (
    Appointment,
    AppointmentStatus,
    Consultation,
    Participant,
    Type,
)
from users.models import DAVAppPassword, User


class _CalDAVBase(TenantTestCase):
    def setUp(self):
        self.owner = User.objects.create_user(
            email="owner@example.com", is_practitioner=True
        )
        self.consultation = Consultation.objects.create(
            title="Follow-up",
            description="Check pulse",
            created_by=self.owner,
            owned_by=self.owner,
        )
        self.appointment = Appointment.objects.create(
            created_by=self.owner,
            consultation=self.consultation,
            title="Weekly call",
            scheduled_at=timezone.now() + timedelta(days=1),
            status=AppointmentStatus.scheduled,
            type=Type.online,
        )

    def _subscriber(self, email, *, is_practitioner=False, visible=False):
        """A user on the appointment roster, with a DAV credential."""
        user = User.objects.create_user(email=email, is_practitioner=is_practitioner)
        Participant.objects.create(
            appointment=self.appointment,
            user=user,
            is_active=True,
            is_consultation_visible=visible,
        )
        app_password = DAVAppPassword.objects.create(user=user, label="Laptop")
        return user, app_password.token

    def _calendar(self, email, token):
        credential = base64.b64encode(f"{email}:{token}".encode()).decode()
        return self.client.get(
            reverse("caldav_calendar"),
            HTTP_AUTHORIZATION=f"Basic {credential}",
        )


class CalDAVConsultationLeakTests(_CalDAVBase):
    def test_guest_gets_the_event_without_the_consultation(self):
        __, token = self._subscriber("guest@example.com")

        body = self._calendar("guest@example.com", token).content.decode()

        # The appointment is theirs: it stays in the calendar.
        self.assertIn("SUMMARY:Weekly call", body)
        # The follow-up behind it is not.
        self.assertNotIn("Follow-up", body)
        self.assertNotIn("Check pulse", body)

    def test_the_flag_brings_the_consultation_back(self):
        __, token = self._subscriber("guest@example.com", visible=True)

        body = self._calendar("guest@example.com", token).content.decode()

        self.assertIn("Consultation: Follow-up", body)
        self.assertIn("Check pulse", body)

    def test_roster_practitioner_reads_it_without_the_flag(self):
        """The sanctioned exemption: a colleague on the roster is in the care."""
        __, token = self._subscriber("colleague@example.com", is_practitioner=True)

        body = self._calendar("colleague@example.com", token).content.decode()

        self.assertIn("Consultation: Follow-up", body)

    def test_owner_reads_their_own_consultation(self):
        Participant.objects.create(
            appointment=self.appointment, user=self.owner, is_active=True
        )
        token = DAVAppPassword.objects.create(user=self.owner, label="Desk").token

        body = self._calendar("owner@example.com", token).content.decode()

        self.assertIn("Consultation: Follow-up", body)

    def test_single_resource_fetch_is_gated_too(self):
        """The per-event route renders the same VEVENT by another path."""
        __, token = self._subscriber("guest@example.com")
        credential = base64.b64encode(f"guest@example.com:{token}".encode()).decode()

        response = self.client.get(
            reverse(
                "caldav_calendar_resource",
                kwargs={"filename": f"appointment-{self.appointment.pk}.ics"},
            ),
            HTTP_AUTHORIZATION=f"Basic {credential}",
        )

        body = response.content.decode()
        self.assertIn("SUMMARY:Weekly call", body)
        self.assertNotIn("Follow-up", body)
        self.assertNotIn("Check pulse", body)
