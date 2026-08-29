"""Who may open a consultation, and how a participant is granted that access."""

from datetime import timedelta

from django.urls import reverse
from django.utils import timezone
from django_tenants.test.cases import TenantTestCase
from rest_framework.test import APIClient

from consultations.models import Consultation, Participant, Type
from users.models import User


class _Base(TenantTestCase):
    def setUp(self):
        self.owner = User.objects.create_user(
            email="owner@example.com", is_practitioner=True
        )
        # A practitioner can be the one being cared for: the beneficiary of a
        # follow-up is not necessarily a patient account.
        self.colleague = User.objects.create_user(
            email="colleague@example.com", is_practitioner=True
        )
        self.consultation = Consultation.objects.create(
            title="Follow-up",
            created_by=self.owner,
            owned_by=self.owner,
            beneficiary=self.colleague,
        )
        self.client = APIClient()
        self.client.force_authenticate(user=self.owner)
        self.colleague_client = APIClient()
        self.colleague_client.force_authenticate(user=self.colleague)

    def _create_appointment(self, **payload_extra):
        return self.client.post(
            reverse("appointment-list"),
            {
                "consultation_id": self.consultation.pk,
                "scheduled_at": (timezone.now() + timedelta(hours=1)).isoformat(),
                "type": Type.online,
                **payload_extra,
            },
            format="json",
        )

    def _detail(self, client):
        return client.get(
            reverse("consultation-detail", kwargs={"pk": self.consultation.pk})
        )


class ParticipantVisibilityTests(_Base):
    """`is_consultation_visible` is what opens the consultation to a participant."""

    def test_flag_grants_access(self):
        third_party = User.objects.create_user(
            email="third@example.com", is_practitioner=True
        )
        response = self._create_appointment(
            participants_ids=[third_party.pk],
            participants_visibility=[
                {"user_id": third_party.pk, "is_consultation_visible": True}
            ],
        )
        self.assertEqual(response.status_code, 201, response.data)

        self.assertTrue(
            Participant.objects.get(user=third_party).is_consultation_visible
        )
        client = APIClient()
        client.force_authenticate(user=third_party)
        self.assertEqual(self._detail(client).status_code, 200)

    def test_a_practitioner_on_the_roster_gets_in_without_the_flag(self):
        """Adding a colleague to an appointment is what invites them to the chat."""
        third_party = User.objects.create_user(
            email="third@example.com", is_practitioner=True
        )
        self._create_appointment(participants_ids=[third_party.pk])

        client = APIClient()
        client.force_authenticate(user=third_party)
        self.assertEqual(self._detail(client).status_code, 200)

    def test_a_guest_still_needs_the_flag(self):
        """The flag keeps someone invited to one call out of the follow-up.

        Asserted on the queryset rather than the endpoint: the practitioner API
        turns a guest away on the permission class, which would pass whatever
        the access rule said.
        """
        guest = User.objects.create_user(email="guest@example.com")
        self._create_appointment(participants_ids=[guest.pk])

        self.assertFalse(Participant.objects.get(user=guest).is_consultation_visible)
        self.assertNotIn(
            self.consultation.pk,
            Consultation.objects.accessible_by(guest).values_list("pk", flat=True),
        )

    def test_a_guest_with_the_flag_reaches_the_consultation(self):
        guest = User.objects.create_user(email="guest@example.com")
        self._create_appointment(
            participants_ids=[guest.pk],
            participants_visibility=[
                {"user_id": guest.pk, "is_consultation_visible": True}
            ],
        )

        self.assertIn(
            self.consultation.pk,
            Consultation.objects.accessible_by(guest).values_list("pk", flat=True),
        )

    def test_flag_survives_an_auto_invited_participant(self):
        """The picked participant is also auto-invited as the beneficiary.

        Their row is created once, by the auto-invite pass; the visibility asked
        for used to be dropped there and the consultation answered 404.
        """
        response = self._create_appointment(
            participants_ids=[self.colleague.pk],
            participants_visibility=[
                {"user_id": self.colleague.pk, "is_consultation_visible": True}
            ],
        )
        self.assertEqual(response.status_code, 201, response.data)

        self.assertTrue(
            Participant.objects.get(user=self.colleague).is_consultation_visible
        )

    def test_roster_practitioner_finds_it_in_their_list(self):
        """Reachable by direct link only would not be much of an access."""
        third_party = User.objects.create_user(
            email="third@example.com", is_practitioner=True
        )
        self._create_appointment(participants_ids=[third_party.pk])

        client = APIClient()
        client.force_authenticate(user=third_party)
        response = client.get(reverse("consultation-list"))

        self.assertEqual(response.status_code, 200)
        self.assertIn(
            self.consultation.pk, [row["id"] for row in response.data["results"]]
        )

    def test_roster_practitioner_cannot_rewrite_the_appointment(self):
        """Reading the follow-up is not authority over it."""
        third_party = User.objects.create_user(
            email="third@example.com", is_practitioner=True
        )
        appointment_id = self._create_appointment(
            participants_ids=[third_party.pk]
        ).data["id"]

        client = APIClient()
        client.force_authenticate(user=third_party)
        response = client.post(
            reverse("appointment-set-status", kwargs={"pk": appointment_id}),
            {"status": "completed"},
            format="json",
        )

        self.assertEqual(response.status_code, 404)

    def test_add_participants_action_grants_access(self):
        third_party = User.objects.create_user(
            email="third@example.com", is_practitioner=True
        )
        appointment_id = self._create_appointment().data["id"]

        response = self.client.post(
            reverse("appointment-add-participants", kwargs={"pk": appointment_id}),
            {
                "participants_ids": [third_party.pk],
                "participants_visibility": [
                    {"user_id": third_party.pk, "is_consultation_visible": True}
                ],
            },
            format="json",
        )

        self.assertEqual(response.status_code, 200, response.data)
        self.assertTrue(
            Participant.objects.get(user=third_party).is_consultation_visible
        )


class RealtimeFanOutTests(_Base):
    """Who the message WebSocket events reach, mirroring who may read them."""

    def _notified(self):
        from consultations.signals import get_users_to_notification_consultation

        return get_users_to_notification_consultation(self.consultation)

    def test_beneficiary_is_notified(self):
        self.assertIn(self.colleague.pk, self._notified())

    def test_visible_participant_is_notified(self):
        third_party = User.objects.create_user(
            email="third@example.com", is_practitioner=True
        )
        self._create_appointment(
            participants_ids=[third_party.pk],
            participants_visibility=[
                {"user_id": third_party.pk, "is_consultation_visible": True}
            ],
        )

        self.assertIn(third_party.pk, self._notified())

    def test_practitioner_on_the_roster_is_notified_without_the_flag(self):
        """Chat access and real-time delivery answer the same question."""
        third_party = User.objects.create_user(
            email="third@example.com", is_practitioner=True
        )
        self._create_appointment(participants_ids=[third_party.pk])

        self.assertIn(third_party.pk, self._notified())

    def test_guest_without_the_flag_is_not_notified(self):
        guest = User.objects.create_user(email="guest@example.com")
        self._create_appointment(participants_ids=[guest.pk])

        self.assertNotIn(guest.pk, self._notified())

    def test_hidden_from_patient_stops_the_fan_out(self):
        """A follow-up hidden from its beneficiary must not push them its messages."""
        self.consultation.visible_by_patient = False
        self.consultation.save(update_fields=["visible_by_patient"])

        self.assertNotIn(self.colleague.pk, self._notified())


class BeneficiaryAccessTests(_Base):
    """The person a follow-up is about can open it, message access being granted."""

    def test_beneficiary_opens_the_consultation(self):
        self.assertEqual(self._detail(self.colleague_client).status_code, 200)

    def test_hidden_from_patient_stays_hidden(self):
        self.consultation.visible_by_patient = False
        self.consultation.save(update_fields=["visible_by_patient"])

        self.assertEqual(self._detail(self.colleague_client).status_code, 404)

    def test_own_care_stays_out_of_the_professional_list(self):
        response = self.colleague_client.get(reverse("consultation-list"))

        self.assertEqual(response.status_code, 200)
        self.assertNotIn(
            self.consultation.pk,
            [row["id"] for row in response.data["results"]],
        )
