"""Who a WebSocket lets in.

A socket handshake is an access decision like any other: the pk comes straight
from the URL, so the consumer has to answer the same question the REST routes
answer before it joins a group or accepts a stream.
"""

from datetime import timedelta

from asgiref.sync import async_to_sync
from channels.testing import WebsocketCommunicator
from django.test import override_settings
from django.utils import timezone
from django_tenants.test.cases import TenantTestCase

from consultations.consumers import (
    AppointmentTranscriptionConsumer,
    ConsultationConsumer,
)
from consultations.models import (
    Appointment,
    AppointmentStatus,
    Consultation,
    Participant,
    Type,
)
from users.models import User

IN_MEMORY_CHANNELS = {
    "default": {"BACKEND": "channels.layers.InMemoryChannelLayer"}
}


class _ConsumerBase(TenantTestCase):
    def setUp(self):
        self.owner = User.objects.create_user(
            email="owner@example.com", is_practitioner=True
        )
        self.outsider = User.objects.create_user(
            email="outsider@example.com", is_practitioner=True
        )
        self.consultation = Consultation.objects.create(
            title="Follow-up", created_by=self.owner, owned_by=self.owner
        )
        self.appointment = Appointment.objects.create(
            created_by=self.owner,
            consultation=self.consultation,
            scheduled_at=timezone.now() + timedelta(days=1),
            status=AppointmentStatus.scheduled,
            type=Type.online,
        )

    def _connect(self, consumer, path, user, route_kwargs):
        """Drive one handshake, returning (accepted, close_code)."""

        async def run():
            communicator = WebsocketCommunicator(consumer.as_asgi(), path)
            communicator.scope["user"] = user
            communicator.scope["url_route"] = {"kwargs": route_kwargs}
            result = await communicator.connect()
            await communicator.disconnect()
            return result

        return async_to_sync(run)()


@override_settings(CHANNEL_LAYERS=IN_MEMORY_CHANNELS)
class ConsultationConsumerAccessTests(_ConsumerBase):
    """Subscribing to a consultation's stream is reading it."""

    def _connect_as(self, user, consultation_pk=None):
        pk = consultation_pk or self.consultation.pk
        return self._connect(
            ConsultationConsumer,
            f"/ws/consultation/{pk}/",
            user,
            {"consultation_pk": str(pk)},
        )

    def test_owner_is_let_in(self):
        connected, __ = self._connect_as(self.owner)

        self.assertTrue(connected)

    def test_stranger_is_turned_away(self):
        connected, code = self._connect_as(self.outsider)

        self.assertFalse(connected)
        self.assertEqual(code, 4003)

    def test_guest_without_the_flag_is_turned_away(self):
        guest = User.objects.create_user(email="guest@example.com")
        Participant.objects.create(
            appointment=self.appointment,
            user=guest,
            is_active=True,
            is_consultation_visible=False,
        )

        connected, code = self._connect_as(guest)

        self.assertFalse(connected)
        self.assertEqual(code, 4003)

    def test_the_flag_lets_the_guest_in(self):
        guest = User.objects.create_user(email="guest@example.com")
        Participant.objects.create(
            appointment=self.appointment,
            user=guest,
            is_active=True,
            is_consultation_visible=True,
        )

        connected, __ = self._connect_as(guest)

        self.assertTrue(connected)

    def test_unknown_consultation_is_turned_away(self):
        connected, code = self._connect_as(self.owner, consultation_pk=999999)

        self.assertFalse(connected)
        self.assertEqual(code, 4003)

    def test_a_non_numeric_pk_does_not_blow_up(self):
        """`\\w+` in the route matches more than digits."""
        connected, code = self._connect(
            ConsultationConsumer,
            "/ws/consultation/abc/",
            self.owner,
            {"consultation_pk": "abc"},
        )

        self.assertFalse(connected)
        self.assertEqual(code, 4003)


@override_settings(CHANNEL_LAYERS=IN_MEMORY_CHANNELS)
class TranscriptionConsumerAccessTests(_ConsumerBase):
    """Streaming into a call writes to its transcript and to its participants."""

    def setUp(self):
        super().setUp()
        from constance import config

        config.enable_live_transcription = True
        self.addCleanup(
            setattr, config, "enable_live_transcription", False
        )

    def _connect_as(self, user):
        return self._connect(
            AppointmentTranscriptionConsumer,
            f"/ws/appointment/{self.appointment.pk}/transcription/",
            user,
            {"appointment_pk": str(self.appointment.pk)},
        )

    def test_participant_is_let_in(self):
        Participant.objects.create(
            appointment=self.appointment, user=self.owner, is_active=True
        )

        connected, __ = self._connect_as(self.owner)

        self.assertTrue(connected)

    def test_stranger_cannot_stream_into_the_call(self):
        connected, code = self._connect_as(self.outsider)

        self.assertFalse(connected)
        self.assertEqual(code, 4003)

    def test_removed_participant_cannot_stream_either(self):
        Participant.objects.create(
            appointment=self.appointment, user=self.outsider, is_active=False
        )

        connected, code = self._connect_as(self.outsider)

        self.assertFalse(connected)
        self.assertEqual(code, 4003)
