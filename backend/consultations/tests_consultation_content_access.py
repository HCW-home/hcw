"""Reaching a consultation's content by a route that is not the consultation.

Messages, attachments, reminders and prescriptions all hang off a consultation.
Each is its own endpoint, so each one restates the access rule — and any one of
them getting it wrong hands out the follow-up just as surely as the detail
route would.
"""

from datetime import timedelta

from django.core.files.uploadedfile import SimpleUploadedFile
from django.urls import reverse
from django.utils import timezone
from django_tenants.test.cases import TenantTestCase
from rest_framework.test import APIClient

from consultations.models import (
    Appointment,
    AppointmentStatus,
    Consultation,
    Message,
    Participant,
    Type,
)
from users.models import User


class _ContentBase(TenantTestCase):
    def setUp(self):
        self.owner = User.objects.create_user(
            email="owner@example.com", is_practitioner=True
        )
        self.patient = User.objects.create_user(email="pat@example.com")
        self.consultation = Consultation.objects.create(
            title="Follow-up",
            created_by=self.owner,
            owned_by=self.owner,
            beneficiary=self.patient,
        )
        self.appointment = Appointment.objects.create(
            created_by=self.owner,
            consultation=self.consultation,
            scheduled_at=timezone.now() + timedelta(days=1),
            status=AppointmentStatus.scheduled,
            type=Type.online,
        )
        self.owner_client = APIClient()
        self.owner_client.force_authenticate(user=self.owner)

    def _roster_client(self, email, *, is_practitioner=False, visible=False):
        user = User.objects.create_user(email=email, is_practitioner=is_practitioner)
        Participant.objects.create(
            appointment=self.appointment,
            user=user,
            is_active=True,
            is_consultation_visible=visible,
        )
        client = APIClient()
        client.force_authenticate(user=user)
        return user, client

    def _message(self, **extra):
        return Message.objects.create(
            consultation=self.consultation,
            created_by=self.owner,
            content="Blood test came back clean",
            **extra,
        )


class MessageAccessTests(_ContentBase):
    """`/api/messages/<id>/` answers the same question as the consultation."""

    def _detail(self, client, message):
        return client.get(reverse("message-detail", kwargs={"pk": message.pk}))

    def test_guest_without_the_flag_cannot_read_a_message(self):
        __, client = self._roster_client("guest@example.com")

        self.assertEqual(self._detail(client, self._message()).status_code, 404)

    def test_the_flag_opens_the_message(self):
        __, client = self._roster_client("guest@example.com", visible=True)

        self.assertEqual(self._detail(client, self._message()).status_code, 200)

    def test_stranger_cannot_read_a_message(self):
        stranger = User.objects.create_user(
            email="stranger@example.com", is_practitioner=True
        )
        client = APIClient()
        client.force_authenticate(user=stranger)

        self.assertEqual(self._detail(client, self._message()).status_code, 404)

    def test_owner_reads_their_own(self):
        self.assertEqual(
            self._detail(self.owner_client, self._message()).status_code, 200
        )

    def test_beneficiary_reads_it(self):
        client = APIClient()
        client.force_authenticate(user=self.patient)

        self.assertEqual(self._detail(client, self._message()).status_code, 200)

    def test_a_follow_up_hidden_from_the_patient_stays_hidden(self):
        """`visible_by_patient` is what hides a follow-up from its beneficiary.

        The message route used to ignore it, so the chat stayed readable on a
        consultation the patient could not open.
        """
        self.consultation.visible_by_patient = False
        self.consultation.save(update_fields=["visible_by_patient"])
        client = APIClient()
        client.force_authenticate(user=self.patient)

        self.assertEqual(self._detail(client, self._message()).status_code, 404)


class MessageAttachmentAccessTests(_ContentBase):
    """The attachment is the message's content by another route."""

    def _attachment_url(self, message):
        return reverse("message_attachment", kwargs={"message_id": message.pk})

    def _message_with_attachment(self):
        return self._message(
            attachment=SimpleUploadedFile("result.txt", b"histology report")
        )

    def test_guest_without_the_flag_is_refused(self):
        message = self._message_with_attachment()
        __, client = self._roster_client("guest@example.com")

        self.assertEqual(client.get(self._attachment_url(message)).status_code, 403)

    def test_the_flag_opens_the_attachment(self):
        message = self._message_with_attachment()
        __, client = self._roster_client("guest@example.com", visible=True)

        self.assertEqual(client.get(self._attachment_url(message)).status_code, 200)

    def test_stranger_is_refused(self):
        message = self._message_with_attachment()
        stranger = User.objects.create_user(
            email="stranger@example.com", is_practitioner=True
        )
        client = APIClient()
        client.force_authenticate(user=stranger)

        self.assertEqual(client.get(self._attachment_url(message)).status_code, 403)


class FhirAppointmentLeakTests(_ContentBase):
    """The FHIR Appointment resource describes itself with the follow-up's words.

    Its read scope is the appointment one — wider than the consultation rule,
    and with the default `users_visibility` it spans every practitioner of the
    tenant — so that description has to be gated like any other content.
    """

    def _fhir_appointment(self, client):
        url = reverse("appointment-detail", kwargs={"pk": self.appointment.pk})
        return client.get(f"{url}?format=fhir")

    def test_stranger_sees_the_slot_without_the_follow_up(self):
        stranger = User.objects.create_user(
            email="stranger@example.com", is_practitioner=True
        )
        client = APIClient()
        client.force_authenticate(user=stranger)

        response = self._fhir_appointment(client)

        # The appointment is visible to them; the consultation's wording is not.
        self.assertEqual(response.status_code, 200)
        self.assertNotIn("Follow-up", str(response.data))

    def test_owner_still_gets_the_description(self):
        response = self._fhir_appointment(self.owner_client)

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["description"], "Follow-up")

    def test_the_encounter_link_survives(self):
        """A reference is not content, and the Encounter route guards itself."""
        stranger = User.objects.create_user(
            email="stranger@example.com", is_practitioner=True
        )
        client = APIClient()
        client.force_authenticate(user=stranger)

        response = self._fhir_appointment(client)

        references = [
            ref["reference"] for ref in response.data.get("supportingInformation", [])
        ]
        self.assertIn(f"Encounter/{self.consultation.pk}", references)


class ReminderAttachmentScopeTests(_ContentBase):
    """A reminder may only be hung on a consultation the user has authority over."""

    def _payload(self, consultation):
        return {
            "title": "Call the lab",
            "consultation_id": consultation.pk,
            "recipient_id": self.patient.pk,
            "scheduled_at": (timezone.now() + timedelta(days=1)).isoformat(),
        }

    def test_outsider_cannot_attach_a_reminder(self):
        outsider = User.objects.create_user(
            email="outsider@example.com", is_practitioner=True
        )
        client = APIClient()
        client.force_authenticate(user=outsider)

        response = client.post(
            reverse("reminder-list"), self._payload(self.consultation), format="json"
        )

        self.assertEqual(response.status_code, 400, response.data)
        self.assertFalse(self.consultation.reminders.exists())

    def test_owner_attaches_normally(self):
        response = self.owner_client.post(
            reverse("reminder-list"), self._payload(self.consultation), format="json"
        )

        self.assertEqual(response.status_code, 201, response.data)
        self.assertTrue(self.consultation.reminders.exists())
