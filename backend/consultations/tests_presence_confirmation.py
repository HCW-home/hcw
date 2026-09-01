from datetime import timedelta

from constance.test import override_config
from django.contrib.contenttypes.models import ContentType
from django.utils import timezone
from django_tenants.test.cases import TenantTestCase
from messaging.models import Message

from consultations.models import (
    Appointment,
    AppointmentStatus,
    Consultation,
    Participant,
)
from consultations.tasks import handle_invites
from consultations.utils import is_immediate_appointment
from users.models import User


class _PresenceConfirmationBase(TenantTestCase):
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

    def _appointment(self, *, starts_in_minutes, previous_scheduled_at=None):
        return Appointment.objects.create(
            created_by=self.practitioner,
            consultation=self.consultation,
            scheduled_at=timezone.now() + timedelta(minutes=starts_in_minutes),
            previous_scheduled_at=previous_scheduled_at,
            status=AppointmentStatus.scheduled,
        )

    def _invite(self, appointment):
        # Keyed on the participant, not on the recipient: assigning the
        # consultation already notified the patient once.
        participant = Participant.objects.create(
            appointment=appointment, user=self.patient
        )
        handle_invites(appointment.pk)
        return Message.objects.get(
            content_type=ContentType.objects.get_for_model(participant),
            object_id=participant.pk,
        )


# Pinned so the "too soon to confirm" window is exactly 30 minutes: the default
# duration is the longer of the two delays that make it up.
@override_config(
    default_appointment_duration_in_minutes=30,
    appointment_last_reminder=10,
    disable_presence_confirmation=False,
)
class PresenceConfirmationTests(_PresenceConfirmationBase):
    """Who gets asked to confirm their presence, and who is told to join.

    Confirming only means something while there is still time to act on the
    answer, so an appointment starting within the window it can already be
    joined in carries a join link instead.
    """

    def test_future_appointment_asks_for_confirmation(self):
        message = self._invite(self._appointment(starts_in_minutes=24 * 60))
        self.assertEqual(message.template_system_name, "invitation_to_appointment")
        self.assertEqual(message.action, "presence")

    def test_immediate_appointment_invites_to_join(self):
        message = self._invite(self._appointment(starts_in_minutes=5))
        self.assertEqual(
            message.template_system_name, "invitation_to_ongoing_appointment"
        )
        self.assertEqual(message.action, "join")

    def test_appointment_starting_right_after_the_window_still_confirms(self):
        message = self._invite(self._appointment(starts_in_minutes=45))
        self.assertEqual(message.template_system_name, "invitation_to_appointment")

    def test_reschedule_into_the_window_invites_to_join(self):
        appointment = self._appointment(
            starts_in_minutes=5,
            previous_scheduled_at=timezone.now() + timedelta(days=2),
        )
        message = self._invite(appointment)
        self.assertEqual(
            message.template_system_name, "invitation_to_ongoing_appointment"
        )

    def test_reschedule_to_a_later_date_still_confirms(self):
        appointment = self._appointment(
            starts_in_minutes=24 * 60,
            previous_scheduled_at=timezone.now() + timedelta(days=2),
        )
        message = self._invite(appointment)
        self.assertEqual(message.template_system_name, "appointment_updated")
        self.assertEqual(message.action, "presence")

    def test_window_never_shorter_than_the_last_reminder(self):
        # A last reminder due before the invitation is even read cannot reach
        # the participant in time either, whatever the default duration.
        with override_config(
            default_appointment_duration_in_minutes=5,
            appointment_last_reminder=60,
        ):
            self.assertTrue(
                is_immediate_appointment(self._appointment(starts_in_minutes=30))
            )

    def test_unusable_config_falls_back_to_no_window(self):
        with override_config(
            default_appointment_duration_in_minutes="",
            appointment_last_reminder="oops",
        ):
            self.assertFalse(
                is_immediate_appointment(self._appointment(starts_in_minutes=1))
            )


@override_config(
    default_appointment_duration_in_minutes=30,
    appointment_last_reminder=10,
    disable_presence_confirmation=True,
)
class DisabledPresenceConfirmationTests(_PresenceConfirmationBase):
    """The instance-wide switch: appointments are still announced, nothing asks
    the recipient to say whether they will be there."""

    def test_invitation_carries_no_confirmation_request(self):
        message = self._invite(self._appointment(starts_in_minutes=24 * 60))
        # The invitation itself is untouched: only its call to action is gone.
        self.assertEqual(message.template_system_name, "invitation_to_appointment")
        self.assertIsNone(message.action)
        self.assertEqual(message.action_label, "")
        self.assertIsNone(message.access_link)

    def test_update_carries_no_confirmation_request(self):
        appointment = self._appointment(
            starts_in_minutes=24 * 60,
            previous_scheduled_at=timezone.now() + timedelta(days=2),
        )
        message = self._invite(appointment)
        self.assertEqual(message.template_system_name, "appointment_updated")
        self.assertIsNone(message.action)

    def test_join_action_is_left_alone(self):
        message = self._invite(self._appointment(starts_in_minutes=5))
        self.assertEqual(
            message.template_system_name, "invitation_to_ongoing_appointment"
        )
        self.assertEqual(message.action, "join")
