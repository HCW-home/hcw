from datetime import timedelta

from constance.test import override_config
from django.utils import timezone
from django_tenants.test.cases import TenantTestCase

from consultations.models import Reminder
from users.models import User
from users.tasks import auto_delete_temporary_users


@override_config(temporary_user_auto_delete=True)
class AutoDeleteTemporaryUsersReminderTests(TenantTestCase):
    def setUp(self):
        self.practitioner = User.objects.create_user(
            email="doc@example.com", password="x", is_practitioner=True
        )

    def _make_temp_user(self, email):
        u = User.objects.create_user(email=email, password="x", temporary=True)
        # Eligible for deletion: joined more than 1h ago.
        User.objects.filter(pk=u.pk).update(
            date_joined=timezone.now() - timedelta(hours=2)
        )
        return u

    def test_temp_user_with_future_reminder_is_kept(self):
        u = self._make_temp_user("temp_future@example.com")
        Reminder.objects.create(
            title="R",
            recipient=u,
            created_by=self.practitioner,
            scheduled_at=timezone.now() + timedelta(days=2),
        )
        auto_delete_temporary_users()
        self.assertTrue(User.objects.filter(pk=u.pk).exists())

    def test_temp_user_with_active_recurring_reminder_is_kept(self):
        u = self._make_temp_user("temp_recurring@example.com")
        Reminder.objects.create(
            title="R",
            recipient=u,
            created_by=self.practitioner,
            scheduled_at=timezone.now() + timedelta(days=1),
            is_recurring=True,
            recurrence_interval=1,
            recurrence_period="week",
            recurrence_count=4,
        )
        auto_delete_temporary_users()
        self.assertTrue(User.objects.filter(pk=u.pk).exists())

    def test_temp_user_with_past_reminder_is_deleted(self):
        u = self._make_temp_user("temp_past@example.com")
        r = Reminder.objects.create(
            title="R",
            recipient=u,
            created_by=self.practitioner,
            scheduled_at=timezone.now() + timedelta(days=1),
        )
        # Simulate an exhausted/past reminder: end in the past, inactive.
        Reminder.objects.filter(pk=r.pk).update(
            recurrence_end_at=timezone.now() - timedelta(days=1),
            is_active=False,
        )
        auto_delete_temporary_users()
        self.assertFalse(User.objects.filter(pk=u.pk).exists())

    def test_temp_user_without_reminder_is_deleted(self):
        u = self._make_temp_user("temp_none@example.com")
        auto_delete_temporary_users()
        self.assertFalse(User.objects.filter(pk=u.pk).exists())
