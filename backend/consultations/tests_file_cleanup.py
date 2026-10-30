"""Deleting a message, or what it hangs off, deletes the files it stored.

A follow-up deleted after its closure, a temporary user deleted with what they
created, or a message deleted by its author must not leave documents and
recordings behind in the storage, with nothing left pointing to them.
"""

from datetime import timedelta
from unittest import mock

from constance.test import override_config
from django.conf import settings
from django.core.files.storage import default_storage
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import override_settings
from django.urls import reverse
from django.utils import timezone
from django_tenants.test.cases import TenantTestCase
from rest_framework.test import APIClient

from consultations.models import (
    Appointment,
    AppointmentRecording,
    AppointmentStatus,
    Consultation,
    Message,
    Type,
)
from consultations.tasks import auto_delete_closed_consultations
from users.models import User

IN_MEMORY_STORAGES = {
    **settings.STORAGES,
    "default": {"BACKEND": "django.core.files.storage.InMemoryStorage"},
}


class AttachmentCleanupTests(TenantTestCase):
    def setUp(self):
        # Not a class decorator: TenantTestCase.setUpClass skips the one of
        # SimpleTestCase, which is what applies class-level overrides.
        self.enterContext(override_settings(STORAGES=IN_MEMORY_STORAGES))
        self.owner = User.objects.create_user(
            email="owner@example.com", is_practitioner=True
        )
        self.consultation = Consultation.objects.create(
            title="Follow-up", created_by=self.owner, owned_by=self.owner
        )

    def _message_with_attachment(self):
        message = Message.objects.create(
            consultation=self.consultation,
            created_by=self.owner,
            attachment=SimpleUploadedFile("report.pdf", b"lab report"),
        )
        self.assertTrue(default_storage.exists(message.attachment.name))
        return message

    def test_deleting_a_message_deletes_its_file(self):
        message = self._message_with_attachment()
        name = message.attachment.name

        with self.captureOnCommitCallbacks(execute=True):
            message.delete()

        self.assertFalse(default_storage.exists(name))

    def test_file_is_only_deleted_once_the_deletion_commits(self):
        message = self._message_with_attachment()
        name = message.attachment.name

        with self.captureOnCommitCallbacks() as callbacks:
            message.delete()

        self.assertTrue(default_storage.exists(name))
        self.assertEqual(len(callbacks), 1)

    def test_author_deleting_a_message_deletes_its_file(self):
        message = self._message_with_attachment()
        name = message.attachment.name
        client = APIClient()
        client.force_authenticate(user=self.owner)

        with self.captureOnCommitCallbacks(execute=True):
            response = client.delete(
                reverse("message-detail", kwargs={"pk": message.pk})
            )

        self.assertEqual(response.status_code, 200)
        self.assertFalse(default_storage.exists(name))

    def test_saving_a_message_keeps_its_file(self):
        message = self._message_with_attachment()

        with self.captureOnCommitCallbacks(execute=True):
            message.content = "See the attached report"
            message.save()

        self.assertTrue(default_storage.exists(message.attachment.name))

    @override_config(consultation_auto_delete_hours=1)
    def test_automatic_deletion_of_a_closed_follow_up_deletes_its_files(self):
        message = self._message_with_attachment()
        name = message.attachment.name
        Consultation.objects.filter(pk=self.consultation.pk).update(
            closed_at=timezone.now() - timedelta(hours=2)
        )

        with self.captureOnCommitCallbacks(execute=True):
            auto_delete_closed_consultations()

        self.assertFalse(Message.objects.filter(pk=message.pk).exists())
        self.assertFalse(default_storage.exists(name))


class RecordingCleanupTests(TenantTestCase):
    def setUp(self):
        self.enterContext(override_settings(LIVEKIT_S3_BUCKET_NAME="recordings"))
        self.owner = User.objects.create_user(
            email="owner@example.com", is_practitioner=True
        )
        self.consultation = Consultation.objects.create(
            title="Follow-up", created_by=self.owner, owned_by=self.owner
        )
        appointment = Appointment.objects.create(
            created_by=self.owner,
            consultation=self.consultation,
            scheduled_at=timezone.now(),
            status=AppointmentStatus.scheduled,
            type=Type.online,
        )
        AppointmentRecording.objects.create(
            appointment=appointment,
            egress_id="EG_1",
            filepath="recordings/appointment_1_1.mp4",
        )

    def test_deleting_a_follow_up_deletes_its_recordings(self):
        with mock.patch("consultations.signals.boto3.client") as client:
            with self.captureOnCommitCallbacks(execute=True):
                self.consultation.delete()

        client.return_value.delete_object.assert_called_once_with(
            Bucket="recordings", Key="recordings/appointment_1_1.mp4"
        )

    def test_a_storage_failure_does_not_fail_the_deletion(self):
        with mock.patch("consultations.signals.boto3.client") as client:
            client.return_value.delete_object.side_effect = OSError("unreachable")
            # Robust callbacks are run and logged by the test case itself here,
            # by django.db.backends.base in production.
            with self.assertLogs("django.test", "ERROR"):
                with self.captureOnCommitCallbacks(execute=True):
                    self.consultation.delete()

        self.assertFalse(Consultation.objects.filter(pk=self.consultation.pk).exists())
