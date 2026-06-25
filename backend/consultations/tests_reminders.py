from datetime import timedelta
from unittest.mock import patch
from zoneinfo import ZoneInfo

from django.urls import reverse
from django.utils import timezone
from django_tenants.test.cases import TenantTestCase
from rest_framework.test import APIClient

from consultations.models import Consultation, RecurrencePeriod, Reminder
from consultations.tasks import handle_custom_reminders
from messaging.models import Message
from users.models import User


class _ReminderBase(TenantTestCase):
    def setUp(self):
        self.practitioner = User.objects.create_user(
            email="doc@example.com", password="x", is_practitioner=True
        )
        self.other_practitioner = User.objects.create_user(
            email="doc2@example.com", password="x", is_practitioner=True
        )
        self.patient = User.objects.create_user(
            email="pat@example.com", password="x"
        )
        self.client = APIClient()
        self.client.force_authenticate(user=self.practitioner)

    def _payload(self, **overrides):
        data = {
            "title": "Take medication",
            "description": "Don't forget your pills",
            "recipient_id": self.patient.id,
            "scheduled_at": (timezone.now() + timedelta(days=1)).isoformat(),
            "is_recurring": False,
        }
        data.update(overrides)
        return data


class ReminderApiTests(_ReminderBase):
    def test_create_reminder(self):
        url = reverse("reminder-list")
        response = self.client.post(url, self._payload(), format="json")
        self.assertEqual(response.status_code, 201, response.data)
        reminder = Reminder.objects.get(pk=response.data["id"])
        self.assertEqual(reminder.created_by, self.practitioner)
        self.assertEqual(reminder.recipient, self.patient)
        self.assertIsNone(reminder.consultation)
        # next_run_at seeded from scheduled_at on creation
        self.assertEqual(reminder.next_run_at, reminder.scheduled_at)

    def test_create_reminder_attached_to_consultation(self):
        consultation = Consultation.objects.create(
            title="Follow-up",
            created_by=self.practitioner,
            beneficiary=self.patient,
        )
        response = self.client.post(
            reverse("reminder-list"),
            self._payload(consultation_id=consultation.id),
            format="json",
        )
        self.assertEqual(response.status_code, 201, response.data)
        reminder = Reminder.objects.get(pk=response.data["id"])
        self.assertEqual(reminder.consultation, consultation)
        self.assertEqual(response.data["consultation"], consultation.id)

    def test_filter_by_consultation(self):
        consultation = Consultation.objects.create(
            title="Follow-up",
            created_by=self.practitioner,
            beneficiary=self.patient,
        )
        attached = Reminder.objects.create(
            title="Attached",
            recipient=self.patient,
            created_by=self.practitioner,
            consultation=consultation,
            scheduled_at=timezone.now() + timedelta(days=1),
        )
        Reminder.objects.create(
            title="Standalone",
            recipient=self.patient,
            created_by=self.practitioner,
            scheduled_at=timezone.now() + timedelta(days=1),
        )
        response = self.client.get(
            reverse("reminder-list"), {"consultation": consultation.id}
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["count"], 1)
        self.assertEqual(response.data["results"][0]["id"], attached.id)

    def test_update_reminder_reschedules_next_run(self):
        reminder = Reminder.objects.create(
            title="Old title",
            recipient=self.patient,
            created_by=self.practitioner,
            scheduled_at=timezone.now() + timedelta(days=1),
        )
        new_dt = timezone.now() + timedelta(days=3)
        response = self.client.patch(
            reverse("reminder-detail", args=[reminder.id]),
            {"title": "New title", "scheduled_at": new_dt.isoformat()},
            format="json",
        )
        self.assertEqual(response.status_code, 200, response.data)
        reminder.refresh_from_db()
        self.assertEqual(reminder.title, "New title")
        # Not yet fired -> next_run_at follows the new scheduled_at.
        self.assertEqual(reminder.next_run_at, reminder.scheduled_at)

    def test_naive_scheduled_at_interpreted_in_user_timezone(self):
        # Practitioner in New York sends a naive local datetime (wall-clock).
        ny = ZoneInfo("America/New_York")
        self.practitioner.timezone = "America/New_York"
        self.practitioner.save(update_fields=["timezone"])

        # A fixed future wall-clock time in NY, e.g. next year at 09:30 local.
        wall = (timezone.now().astimezone(ny) + timedelta(days=300)).replace(
            hour=9, minute=30, second=0, microsecond=0, tzinfo=None
        )
        naive_local = wall.strftime("%Y-%m-%dT%H:%M:%S")

        response = self.client.post(
            reverse("reminder-list"),
            self._payload(scheduled_at=naive_local),
            format="json",
        )
        self.assertEqual(response.status_code, 201, response.data)
        reminder = Reminder.objects.get(pk=response.data["id"])

        # The stored instant must be that wall-clock time bound to the NY tz.
        expected = wall.replace(tzinfo=ny)
        self.assertEqual(reminder.scheduled_at, expected)

        # Representation: same wall-clock time, expressed in the NY timezone.
        out = timezone.datetime.fromisoformat(response.data["scheduled_at"])
        self.assertEqual(out, expected)
        self.assertEqual((out.hour, out.minute), (9, 30))

    def test_filter_by_recipient(self):
        other_patient = User.objects.create_user(
            email="pat2@example.com", password="x"
        )
        mine = Reminder.objects.create(
            title="For patient 1",
            recipient=self.patient,
            created_by=self.practitioner,
            scheduled_at=timezone.now() + timedelta(days=1),
        )
        Reminder.objects.create(
            title="For patient 2",
            recipient=other_patient,
            created_by=self.practitioner,
            scheduled_at=timezone.now() + timedelta(days=1),
        )
        response = self.client.get(
            reverse("reminder-list"), {"recipient": self.patient.id}
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["count"], 1)
        self.assertEqual(response.data["results"][0]["id"], mine.id)

    def test_queryset_filtered_by_creator(self):
        Reminder.objects.create(
            title="Mine",
            recipient=self.patient,
            created_by=self.practitioner,
            scheduled_at=timezone.now() + timedelta(days=1),
        )
        self.client.force_authenticate(user=self.other_practitioner)
        response = self.client.get(reverse("reminder-list"))
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["count"], 0)

    def test_patient_forbidden(self):
        self.client.force_authenticate(user=self.patient)
        response = self.client.post(
            reverse("reminder-list"), self._payload(), format="json"
        )
        self.assertEqual(response.status_code, 403)

    def test_validation_past(self):
        response = self.client.post(
            reverse("reminder-list"),
            self._payload(scheduled_at=(timezone.now() - timedelta(days=1)).isoformat()),
            format="json",
        )
        self.assertEqual(response.status_code, 400)
        self.assertIn("scheduled_at", response.data)

    def test_validation_recurring_requires_period(self):
        response = self.client.post(
            reverse("reminder-list"),
            self._payload(is_recurring=True),
            format="json",
        )
        self.assertEqual(response.status_code, 400)
        self.assertIn("recurrence_period", response.data)


class ReminderTaskTests(_ReminderBase):
    @patch("messaging.tasks.send_message.delay")
    def test_task_creates_message_and_deactivates(self, mock_send):
        now = timezone.now().replace(second=0, microsecond=0)
        reminder = Reminder.objects.create(
            title="Hello",
            description="Body text",
            recipient=self.patient,
            created_by=self.practitioner,
            scheduled_at=now,
        )
        self.assertEqual(reminder.next_run_at, now)

        handle_custom_reminders()

        msg = Message.objects.get(sent_to=self.patient)
        # The Message is rendered through the "reminder" template, with the
        # reminder itself as the template object.
        self.assertEqual(msg.template_system_name, "reminder")
        self.assertEqual(msg.content_object, reminder)

        reminder.refresh_from_db()
        self.assertEqual(reminder.occurrences_sent, 1)
        self.assertFalse(reminder.is_active)
        self.assertIsNone(reminder.next_run_at)

    @patch("messaging.tasks.send_message.delay")
    def test_message_renders_through_reminder_template(self, mock_send):
        """The Message produced by the task renders the title/description
        through the "reminder" template, exercising the same properties the
        email/SMS providers rely on."""
        now = timezone.now().replace(second=0, microsecond=0)
        Reminder.objects.create(
            title="Visit reminder",
            description="Please attend your appointment.",
            recipient=self.patient,
            created_by=self.practitioner,
            scheduled_at=now,
        )

        handle_custom_reminders()

        msg = Message.objects.get(sent_to=self.patient)
        # Subject comes from the title.
        self.assertEqual(msg.render_subject, "Visit reminder")
        # Plain-text/SMS bodies carry both the title and the description.
        self.assertIn("Visit reminder", msg.render_content)
        self.assertIn("Please attend your appointment.", msg.render_content)
        self.assertIn("Please attend your appointment.", msg.render_content_sms)
        # HTML rendering must not raise and must carry the content.
        self.assertIn("Please attend your appointment.", msg.render_content_html)

    @patch("messaging.tasks.send_message.delay")
    def test_message_renders_without_description(self, mock_send):
        """A reminder with no description still renders cleanly (the template
        guards the optional description block)."""
        now = timezone.now().replace(second=0, microsecond=0)
        Reminder.objects.create(
            title="Standalone title",
            recipient=self.patient,
            created_by=self.practitioner,
            scheduled_at=now,
        )

        handle_custom_reminders()

        msg = Message.objects.get(sent_to=self.patient)
        self.assertEqual(msg.render_subject, "Standalone title")
        self.assertIn("Standalone title", msg.render_content)

    @patch("messaging.tasks.send_message.delay")
    def test_recurrence_reschedules_until_exhausted(self, mock_send):
        now = timezone.now().replace(second=0, microsecond=0)
        reminder = Reminder.objects.create(
            title="Daily",
            recipient=self.patient,
            created_by=self.practitioner,
            scheduled_at=now,
            is_recurring=True,
            recurrence_interval=1,
            recurrence_period=RecurrencePeriod.day,
            recurrence_count=3,
        )

        # Occurrence 1 (today)
        handle_custom_reminders()
        reminder.refresh_from_db()
        self.assertEqual(reminder.occurrences_sent, 1)
        self.assertEqual(reminder.next_run_at, now + timedelta(days=1))
        self.assertTrue(reminder.is_active)

        # Occurrence 2 (+1 day): advance the matched minute
        reminder.next_run_at = now
        reminder.save(update_fields=["next_run_at"])
        handle_custom_reminders()
        reminder.refresh_from_db()
        self.assertEqual(reminder.occurrences_sent, 2)
        self.assertEqual(reminder.next_run_at, now + timedelta(days=1))
        self.assertTrue(reminder.is_active)

        # Occurrence 3 (last): schedule exhausted afterwards
        reminder.next_run_at = now
        reminder.save(update_fields=["next_run_at"])
        handle_custom_reminders()
        reminder.refresh_from_db()
        self.assertEqual(reminder.occurrences_sent, 3)
        self.assertFalse(reminder.is_active)
        self.assertIsNone(reminder.next_run_at)

        self.assertEqual(Message.objects.filter(sent_to=self.patient).count(), 3)
