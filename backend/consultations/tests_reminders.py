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

    @patch("messaging.tasks.send_message.delay")
    def test_overdue_reminder_is_sent(self, mock_send):
        """A one-off reminder whose next_run_at is in the past (missed beat)
        is still delivered."""
        past = timezone.now().replace(second=0, microsecond=0) - timedelta(hours=2)
        reminder = Reminder.objects.create(
            title="Late",
            recipient=self.patient,
            created_by=self.practitioner,
            scheduled_at=past,
        )
        self.assertEqual(reminder.next_run_at, past)

        handle_custom_reminders()

        self.assertEqual(Message.objects.filter(sent_to=self.patient).count(), 1)
        reminder.refresh_from_db()
        self.assertEqual(reminder.occurrences_sent, 1)
        self.assertFalse(reminder.is_active)

    @patch("messaging.tasks.send_message.delay")
    def test_recurring_backlog_is_caught_up(self, mock_send):
        """After downtime, a daily reminder started in the past catches up all
        the missed occurrences in a single run, one Message each.

        Start is offset by 12h so occurrence times never land exactly on the
        current minute (avoids a boundary-dependent count).
        """
        start = timezone.now().replace(
            second=0, microsecond=0
        ) - timedelta(days=3, hours=12)
        reminder = Reminder.objects.create(
            title="Daily",
            recipient=self.patient,
            created_by=self.practitioner,
            scheduled_at=start,
            is_recurring=True,
            recurrence_interval=1,
            recurrence_period=RecurrencePeriod.day,
            recurrence_count=10,
        )

        handle_custom_reminders()

        # Occurrences at start, +1d, +2d, +3d (all in the past) -> 4 messages;
        # the 5th (+4d, ~12h in the future) is not yet due.
        self.assertEqual(Message.objects.filter(sent_to=self.patient).count(), 4)
        reminder.refresh_from_db()
        self.assertEqual(reminder.occurrences_sent, 4)
        self.assertTrue(reminder.is_active)
        self.assertEqual(reminder.next_run_at, start + timedelta(days=4))
        self.assertGreater(reminder.next_run_at, timezone.now())


class ReminderOccurrenceTests(_ReminderBase):
    def _mk(self, **kw):
        defaults = dict(
            title="R",
            recipient=self.patient,
            created_by=self.practitioner,
        )
        defaults.update(kw)
        return Reminder.objects.create(**defaults)

    def test_recurrence_end_at_non_recurring_equals_scheduled(self):
        dt = timezone.now() + timedelta(days=2)
        r = self._mk(scheduled_at=dt)
        self.assertEqual(r.recurrence_end_at, r.scheduled_at)

    def test_recurrence_end_at_weekly(self):
        dt = timezone.now() + timedelta(days=1)
        r = self._mk(
            scheduled_at=dt,
            is_recurring=True,
            recurrence_interval=1,
            recurrence_period=RecurrencePeriod.week,
            recurrence_count=3,
        )
        # 3 occurrences -> last is +2 weeks.
        self.assertEqual(r.recurrence_end_at, dt + timedelta(weeks=2))

    def test_occurrences_between_filters_window(self):
        base = timezone.now().replace(microsecond=0) + timedelta(days=1)
        r = self._mk(
            scheduled_at=base,
            is_recurring=True,
            recurrence_interval=1,
            recurrence_period=RecurrencePeriod.week,
            recurrence_count=4,
        )
        # Occurrences: base, +1w, +2w, +3w. Window covering only the 2nd one.
        win_start = base + timedelta(weeks=1) - timedelta(hours=1)
        win_end = base + timedelta(weeks=1) + timedelta(hours=1)
        occ = r.occurrences_between(win_start, win_end)
        self.assertEqual(len(occ), 1)
        self.assertEqual(occ[0][0], 1)  # index
        self.assertEqual(occ[0][1], base + timedelta(weeks=1))

    def test_occurrences_endpoint_expands_recurring_in_window(self):
        # Weekly reminder starting BEFORE the window, with an occurrence inside.
        base = timezone.now().replace(hour=9, minute=0, second=0, microsecond=0)
        start = base - timedelta(days=3)  # first occurrence 3 days ago
        r = self._mk(
            scheduled_at=start,
            is_recurring=True,
            recurrence_interval=1,
            recurrence_period=RecurrencePeriod.day,
            recurrence_count=10,
        )
        # Window = today .. +2 days (excludes the first occurrence).
        win_start = (base).date().isoformat()
        win_end = (base + timedelta(days=2)).date().isoformat()
        resp = self.client.get(
            reverse("reminder-occurrences"),
            {"start": win_start, "end": win_end},
        )
        self.assertEqual(resp.status_code, 200, resp.data)
        # Occurrences for days 0,1,2 of the window -> 3 entries, same reminder.
        self.assertTrue(len(resp.data) >= 3)
        self.assertTrue(all(o["reminder_id"] == r.id for o in resp.data))

    def test_occurrences_endpoint_excludes_out_of_window(self):
        # A non-recurring reminder far in the future is excluded from a past window.
        future = timezone.now() + timedelta(days=60)
        self._mk(scheduled_at=future)
        resp = self.client.get(
            reverse("reminder-occurrences"),
            {
                "start": timezone.now().date().isoformat(),
                "end": (timezone.now() + timedelta(days=2)).date().isoformat(),
            },
        )
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(len(resp.data), 0)

    def test_occurrences_endpoint_requires_params(self):
        resp = self.client.get(reverse("reminder-occurrences"))
        self.assertEqual(resp.status_code, 400)
