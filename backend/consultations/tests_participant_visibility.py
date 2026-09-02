"""Who may open a consultation, and how a participant is granted that access."""

import json
from datetime import timedelta
from unittest.mock import MagicMock, patch

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

    def test_a_practitioner_without_the_flag_stays_out(self):
        """Unticking the box is a decision, and it holds for a colleague too.

        Adding a practitioner to one appointment invites them to that call; the
        follow-up behind it is only opened by the visibility flag.
        """
        third_party = User.objects.create_user(
            email="third@example.com", is_practitioner=True
        )
        self._create_appointment(participants_ids=[third_party.pk])

        self.assertFalse(
            Participant.objects.get(user=third_party).is_consultation_visible
        )
        client = APIClient()
        client.force_authenticate(user=third_party)
        self.assertEqual(self._detail(client).status_code, 404)

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

    def test_visible_practitioner_finds_it_in_their_list(self):
        """Reachable by direct link only would not be much of an access."""
        third_party = User.objects.create_user(
            email="third@example.com", is_practitioner=True
        )
        self._create_appointment(
            participants_ids=[third_party.pk],
            participants_visibility=[
                {"user_id": third_party.pk, "is_consultation_visible": True}
            ],
        )

        client = APIClient()
        client.force_authenticate(user=third_party)
        response = client.get(reverse("consultation-list"))

        self.assertEqual(response.status_code, 200)
        self.assertIn(
            self.consultation.pk, [row["id"] for row in response.data["results"]]
        )

    def test_practitioner_without_the_flag_cannot_rewrite_the_appointment(self):
        """Being on one roster is not authority over the case behind it."""
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

    def test_add_participants_action_honours_an_unticked_box(self):
        third_party = User.objects.create_user(
            email="third@example.com", is_practitioner=True
        )
        appointment_id = self._create_appointment().data["id"]

        self._add_participants(appointment_id, third_party, visible=False)

        self.assertFalse(
            Participant.objects.get(user=third_party).is_consultation_visible
        )
        client = APIClient()
        client.force_authenticate(user=third_party)
        self.assertEqual(self._detail(client).status_code, 404)

    def test_adding_someone_back_unticked_takes_the_access_away(self):
        """Re-adding is a fresh decision, not a return to the previous one.

        The row is reused when a removed participant comes back, and it still
        carried the visibility granted the first time.
        """
        third_party = User.objects.create_user(
            email="third@example.com", is_practitioner=True
        )
        appointment_id = self._create_appointment(
            participants_ids=[third_party.pk],
            participants_visibility=[
                {"user_id": third_party.pk, "is_consultation_visible": True}
            ],
        ).data["id"]
        participant = Participant.objects.get(user=third_party)
        participant.is_active = False
        participant.save(update_fields=["is_active"])

        self._add_participants(appointment_id, third_party, visible=False)

        participant.refresh_from_db()
        self.assertTrue(participant.is_active)
        self.assertFalse(participant.is_consultation_visible)
        client = APIClient()
        client.force_authenticate(user=third_party)
        self.assertEqual(self._detail(client).status_code, 404)

    def _add_participants(self, appointment_id, user, visible):
        response = self.client.post(
            reverse("appointment-add-participants", kwargs={"pk": appointment_id}),
            {
                "participants_ids": [user.pk],
                "participants_visibility": [
                    {"user_id": user.pk, "is_consultation_visible": visible}
                ],
            },
            format="json",
        )
        self.assertEqual(response.status_code, 200, response.data)
        return response


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

    def test_practitioner_without_the_flag_is_not_notified(self):
        """Chat access and real-time delivery answer the same question."""
        third_party = User.objects.create_user(
            email="third@example.com", is_practitioner=True
        )
        self._create_appointment(participants_ids=[third_party.pk])

        self.assertNotIn(third_party.pk, self._notified())

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


class RosterPractitionerWithoutTheFlagTests(_Base):
    """A colleague added to one appointment with the box unticked.

    They take part in that call and nothing else: the follow-up behind it stays
    closed, in reading as in writing.
    """

    def setUp(self):
        super().setUp()
        self.third_party = User.objects.create_user(
            email="third@example.com", is_practitioner=True
        )
        self._create_appointment(participants_ids=[self.third_party.pk])
        self.third_party_client = APIClient()
        self.third_party_client.force_authenticate(user=self.third_party)

    def _url(self, name="consultation-detail"):
        return reverse(name, kwargs={"pk": self.consultation.pk})

    def test_they_do_not_read_it(self):
        self.assertEqual(self._detail(self.third_party_client).status_code, 404)

    def test_they_cannot_rewrite_it(self):
        response = self.third_party_client.patch(
            self._url(), {"title": "Hijacked"}, format="json"
        )

        self.assertEqual(response.status_code, 404)
        self.consultation.refresh_from_db()
        self.assertEqual(self.consultation.title, "Follow-up")

    def test_they_cannot_close_it(self):
        response = self.third_party_client.post(self._url("consultation-close"))

        self.assertEqual(response.status_code, 404)
        self.consultation.refresh_from_db()
        self.assertIsNone(self.consultation.closed_at)

    def test_they_cannot_delete_it(self):
        response = self.third_party_client.delete(self._url())

        self.assertEqual(response.status_code, 404)
        self.assertTrue(Consultation.objects.filter(pk=self.consultation.pk).exists())

    def test_the_owner_still_rewrites_it(self):
        response = self.client.patch(
            self._url(), {"title": "Renamed"}, format="json"
        )

        self.assertEqual(response.status_code, 200, response.data)
        self.consultation.refresh_from_db()
        self.assertEqual(self.consultation.title, "Renamed")

    def test_they_cannot_mark_it_read(self):
        """Nothing to read means no read position to track either."""
        response = self.third_party_client.post(self._url("consultation-mark-read"))

        self.assertEqual(response.status_code, 404)


class InvitedPractitionerRosterTests(_Base):
    """A practitioner invited to a call manages that call's roster.

    Sitting on the roster is not authority over the follow-up behind it, but it
    is enough to grow the meeting: whoever needs a colleague in the room is
    rarely the one who booked it, and chasing the organiser mid-call is not an
    option.
    """

    def setUp(self):
        super().setUp()
        self.invited = User.objects.create_user(
            email="invited@example.com", is_practitioner=True
        )
        self.appointment_id = self._create_appointment(
            participants_ids=[self.invited.pk]
        ).data["id"]
        self.invited_client = APIClient()
        self.invited_client.force_authenticate(user=self.invited)
        self.newcomer = User.objects.create_user(
            email="newcomer@example.com", is_practitioner=True
        )

    def _add(self, client, appointment_id, user, visible=False):
        return client.post(
            reverse("appointment-add-participants", kwargs={"pk": appointment_id}),
            {
                "participants_ids": [user.pk],
                "participants_visibility": [
                    {"user_id": user.pk, "is_consultation_visible": visible}
                ],
            },
            format="json",
        )

    def _remove(self, client, appointment_id, user):
        return client.post(
            reverse("appointment-remove-participant", kwargs={"pk": appointment_id}),
            {"user_id": user.pk},
            format="json",
        )

    def test_they_add_a_participant(self):
        """The box unticked keeps them out of the follow-up, not out of the call."""
        self.assertFalse(
            Participant.objects.get(user=self.invited).is_consultation_visible
        )

        response = self._add(self.invited_client, self.appointment_id, self.newcomer)

        self.assertEqual(response.status_code, 200, response.data)
        self.assertTrue(
            Participant.objects.filter(
                user=self.newcomer, appointment_id=self.appointment_id, is_active=True
            ).exists()
        )

    def test_they_remove_a_participant(self):
        self._add(self.invited_client, self.appointment_id, self.newcomer)

        response = self._remove(self.invited_client, self.appointment_id, self.newcomer)

        self.assertEqual(response.status_code, 200, response.data)
        self.assertFalse(
            Participant.objects.get(
                user=self.newcomer, appointment_id=self.appointment_id
            ).is_active
        )

    def test_being_taken_off_the_call_takes_the_rights_with_it(self):
        """The scope reads ``is_active``, so a removed row grants nothing."""
        participant = Participant.objects.get(user=self.invited)
        participant.is_active = False
        participant.save(update_fields=["is_active"])

        response = self._add(self.invited_client, self.appointment_id, self.newcomer)

        self.assertEqual(response.status_code, 404)

    def test_an_outsider_still_cannot_add(self):
        outsider = User.objects.create_user(
            email="outsider@example.com", is_practitioner=True
        )
        client = APIClient()
        client.force_authenticate(user=outsider)

        response = self._add(client, self.appointment_id, self.newcomer)

        self.assertEqual(response.status_code, 404)

    def test_a_guest_on_the_roster_cannot_add(self):
        """Managing the roster is a practitioner's job, not every attendee's."""
        guest = User.objects.create_user(email="guest@example.com")
        appointment_id = self._create_appointment(
            participants_ids=[guest.pk]
        ).data["id"]
        client = APIClient()
        client.force_authenticate(user=guest)

        response = self._add(client, appointment_id, self.newcomer)

        self.assertEqual(response.status_code, 403)

    def test_the_follow_up_behind_it_stays_closed(self):
        """Roster rights stop at the call: the case itself is untouched."""
        response = self.invited_client.post(
            reverse("appointment-set-status", kwargs={"pk": self.appointment_id}),
            {"status": "completed"},
            format="json",
        )

        self.assertEqual(response.status_code, 404)
        self.assertEqual(self._detail(self.invited_client).status_code, 404)


def _mocked_server():
    """Stand-in for a media server able to mute remotely."""
    server = MagicMock()
    server.instance.supports_remote_mute.return_value = True
    server.instance.mute_participant.return_value = 1
    return server


class CallModerationTests(_Base):
    """Muting a microphone belongs to whoever is in the room.

    Echo and feedback are heard by the people on the call, not by the organiser
    who booked it, so a practitioner invited to the meeting may silence a
    participant — practitioner or patient alike.
    """

    def setUp(self):
        super().setUp()
        self.invited = User.objects.create_user(
            email="invited@example.com", is_practitioner=True
        )
        self.noisy = User.objects.create_user(email="noisy@example.com")
        self.appointment_id = self._create_appointment(
            participants_ids=[self.invited.pk, self.noisy.pk]
        ).data["id"]
        self.invited_client = APIClient()
        self.invited_client.force_authenticate(user=self.invited)

    def _mute(self, client, target, muted=True, appointment_id=None):
        with patch(
            "consultations.views.Server.get_or_pin_for_room",
            return_value=_mocked_server(),
        ):
            return client.post(
                reverse(
                    "appointment-mute-participant",
                    kwargs={"pk": appointment_id or self.appointment_id},
                ),
                {"target_user_id": target.pk, "muted": muted},
                format="json",
            )

    def test_an_invited_practitioner_mutes_a_patient(self):
        response = self._mute(self.invited_client, self.noisy)

        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data["status"], "muted")

    def test_an_invited_practitioner_unmutes(self):
        response = self._mute(self.invited_client, self.noisy, muted=False)

        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data["status"], "unmuted")

    def test_a_colleague_can_be_muted_too(self):
        """Feedback does not care about the role of whoever is causing it."""
        response = self._mute(self.invited_client, self.owner)

        self.assertEqual(response.status_code, 200, response.data)

    def test_the_owner_still_mutes(self):
        response = self._mute(self.client, self.noisy)

        self.assertEqual(response.status_code, 200, response.data)

    def test_a_removed_practitioner_no_longer_mutes(self):
        participant = Participant.objects.get(
            user=self.invited, appointment_id=self.appointment_id
        )
        participant.is_active = False
        participant.save(update_fields=["is_active"])

        response = self._mute(self.invited_client, self.noisy)

        self.assertEqual(response.status_code, 403, response.data)

    def test_a_practitioner_outside_the_call_does_not_mute(self):
        """The read scope reaches a visible colleague's appointments.

        Being able to see a meeting is not being in it, and moderation is for
        the room.
        """
        outsider = User.objects.create_user(
            email="outsider@example.com", is_practitioner=True
        )
        client = APIClient()
        client.force_authenticate(user=outsider)

        response = self._mute(client, self.noisy)

        self.assertIn(response.status_code, (403, 404), response.data)

    def test_a_patient_on_the_roster_does_not_mute(self):
        """Moderation stays a practitioner's tool."""
        client = APIClient()
        client.force_authenticate(user=self.noisy)

        response = self._mute(client, self.invited)

        self.assertEqual(response.status_code, 403, response.data)


class NestedConsultationTests(_Base):
    """A consultation nested in an appointment payload obeys the same rule.

    The patient endpoints are scoped on the *roster*, which is wider than the
    consultation rule; the nested object used to ride along unchecked and hand
    a guest the whole follow-up.
    """

    def _guest_on_the_roster(self, visible=False):
        guest = User.objects.create_user(email="guest@example.com")
        extra = {}
        if visible:
            extra["participants_visibility"] = [
                {"user_id": guest.pk, "is_consultation_visible": True}
            ]
        self._create_appointment(participants_ids=[guest.pk], **extra)
        client = APIClient()
        client.force_authenticate(user=guest)
        return guest, client

    def test_guest_gets_the_appointment_without_the_consultation(self):
        __, client = self._guest_on_the_roster()

        response = client.get(reverse("user-participants-list"))
        self.assertEqual(response.status_code, 200)
        appointment = response.data["results"][0]["appointment"]
        self.assertIsNone(appointment["consultation"])
        self.assertIsNone(appointment["consultation_title"])
        # The bare id is what the client routes on: left in place it offers a
        # link to the follow-up and loads its chat, both answering 404.
        self.assertIsNone(appointment["consultation_id"])

    def test_the_flag_brings_the_consultation_back(self):
        __, client = self._guest_on_the_roster(visible=True)

        response = client.get(reverse("user-participants-list"))
        appointment = response.data["results"][0]["appointment"]
        self.assertEqual(appointment["consultation"]["id"], self.consultation.pk)
        self.assertEqual(appointment["consultation_id"], self.consultation.pk)
        self.assertEqual(appointment["consultation_title"], "Follow-up")

    def test_appointment_list_hides_the_title_from_a_guest(self):
        __, client = self._guest_on_the_roster()

        response = client.get(reverse("user-appointments-list"))
        self.assertEqual(response.status_code, 200)
        self.assertIsNone(response.data["results"][0]["consultation_title"])
        self.assertIsNone(response.data["results"][0]["consultation_id"])

    def test_practitioner_appointment_list_hides_the_id_too(self):
        """The practitioner API serves the same appointment through its own
        serializer, and the modal reads the id from there."""
        third_party = User.objects.create_user(
            email="third@example.com", is_practitioner=True
        )
        self._create_appointment(participants_ids=[third_party.pk])
        client = APIClient()
        client.force_authenticate(user=third_party)

        response = client.get(reverse("appointment-list"))

        self.assertEqual(response.status_code, 200)
        row = next(
            r for r in response.data["results"] if r["participants"]
        )
        self.assertIsNone(row["consultation_id"])
        self.assertIsNone(row["consultation_title"])

    def test_the_flag_puts_the_id_back_for_a_practitioner(self):
        third_party = User.objects.create_user(
            email="third@example.com", is_practitioner=True
        )
        self._create_appointment(
            participants_ids=[third_party.pk],
            participants_visibility=[
                {"user_id": third_party.pk, "is_consultation_visible": True}
            ],
        )
        client = APIClient()
        client.force_authenticate(user=third_party)

        response = client.get(reverse("appointment-list"))

        row = response.data["results"][0]
        self.assertEqual(row["consultation_id"], self.consultation.pk)


class TemporaryConsultationTests(TenantTestCase):
    """The chat spun up for an appointment booked outside any follow-up.

    Its participants sit on a roster like any other, so the visibility box
    decides there too; whoever booked the appointment owns the container and
    reaches it as its creator.
    """

    def setUp(self):
        self.owner = User.objects.create_user(
            email="owner@example.com", is_practitioner=True
        )
        self.client = APIClient()
        self.client.force_authenticate(user=self.owner)
        self.guest = User.objects.create_user(
            email="third@example.com", is_practitioner=True
        )
        self.guest_client = APIClient()
        self.guest_client.force_authenticate(user=self.guest)

    def _book(self, visible=None):
        """An online appointment with no follow-up: a temporary one is created."""
        payload = {
            "scheduled_at": (timezone.now() + timedelta(hours=1)).isoformat(),
            "type": Type.online,
            "participants_ids": [self.guest.pk],
        }
        if visible is not None:
            payload["participants_visibility"] = [
                {"user_id": self.guest.pk, "is_consultation_visible": visible}
            ]
        response = self.client.post(
            reverse("appointment-list"), payload, format="json"
        )
        self.assertEqual(response.status_code, 201, response.data)
        consultation = Consultation.objects.get(
            appointments__id=response.data["id"]
        )
        self.assertTrue(consultation.temporary)
        return consultation

    def _detail(self, client, consultation):
        return client.get(
            reverse("consultation-detail", kwargs={"pk": consultation.pk})
        )

    def test_the_box_decides_here_too(self):
        consultation = self._book(visible=False)

        self.assertEqual(
            self._detail(self.guest_client, consultation).status_code, 404
        )

    def test_the_flag_opens_the_appointment_chat(self):
        consultation = self._book(visible=True)

        self.assertEqual(
            self._detail(self.guest_client, consultation).status_code, 200
        )

    def test_whoever_booked_it_still_reads_it(self):
        consultation = self._book(visible=False)

        self.assertEqual(self._detail(self.client, consultation).status_code, 200)

    def test_an_invited_practitioner_grows_the_ad_hoc_call(self):
        """There is no follow-up to be a member of: the roster is all there is.

        ``accessible_by`` filters temporary consultations out, so the roster
        branch is what lets a guest practitioner add anyone here.
        """
        consultation = self._book(visible=False)
        appointment_id = consultation.appointments.get().pk
        newcomer = User.objects.create_user(
            email="newcomer@example.com", is_practitioner=True
        )

        response = self.guest_client.post(
            reverse("appointment-add-participants", kwargs={"pk": appointment_id}),
            {"participants_ids": [newcomer.pk]},
            format="json",
        )

        self.assertEqual(response.status_code, 200, response.data)
        self.assertTrue(
            Participant.objects.filter(
                user=newcomer, appointment_id=appointment_id, is_active=True
            ).exists()
        )

    def test_the_fan_out_follows(self):
        from consultations.signals import get_users_to_notification_consultation

        consultation = self._book(visible=False)

        notified = get_users_to_notification_consultation(consultation)
        self.assertIn(self.owner.pk, notified)
        self.assertNotIn(self.guest.pk, notified)


class ConsultationAttachmentTests(_Base):
    """Hanging an appointment on a consultation is a write on that consultation.

    Left unchecked it is also a read grant: the author lands on the roster of
    the new appointment, which opens the follow-up back to them.
    """

    def setUp(self):
        super().setUp()
        self.outsider = User.objects.create_user(
            email="outsider@example.com", is_practitioner=True
        )
        self.outsider_client = APIClient()
        self.outsider_client.force_authenticate(user=self.outsider)

    def _outsider_payload(self):
        return {
            "consultation_id": self.consultation.pk,
            "scheduled_at": (timezone.now() + timedelta(hours=1)).isoformat(),
            "type": Type.online,
        }

    def test_outsider_cannot_attach_an_appointment(self):
        response = self.outsider_client.post(
            reverse("appointment-list"), self._outsider_payload(), format="json"
        )

        self.assertEqual(response.status_code, 400, response.data)
        self.assertFalse(self.consultation.appointments.exists())

    def test_refused_attachment_grants_no_read(self):
        self.outsider_client.post(
            reverse("appointment-list"), self._outsider_payload(), format="json"
        )

        self.assertEqual(self._detail(self.outsider_client).status_code, 404)

    def test_fhir_encounter_reference_is_scoped_too(self):
        """The FHIR mapper is a second door onto the same hole."""
        payload = {
            "resourceType": "Appointment",
            "status": "booked",
            "start": (timezone.now() + timedelta(hours=1)).isoformat(),
            "supportingInformation": [
                {"reference": f"Encounter/{self.consultation.pk}"}
            ],
            # The attack in full: put yourself on the roster of an appointment
            # hung on someone else's follow-up, and read it back.
            "participant": [
                {
                    "actor": {"reference": f"Practitioner/{self.outsider.pk}"},
                    "status": "accepted",
                }
            ],
        }
        response = self.outsider_client.post(
            reverse("appointment-list"),
            data=json.dumps(payload),
            content_type="application/fhir+json",
            HTTP_ACCEPT="application/fhir+json",
        )

        self.assertEqual(response.status_code, 404, response.data)
        self.assertFalse(self.consultation.appointments.exists())

    def test_the_owner_still_attaches_normally(self):
        response = self._create_appointment()

        self.assertEqual(response.status_code, 201, response.data)
        self.assertTrue(self.consultation.appointments.exists())
