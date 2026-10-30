"""Message attachments encrypted at rest, from the API and the admin.

The storage is tested on its own in core.tests_encrypted_storage; these check
that nothing above it notices: attachments are ciphertext on disk, and every
way to one still hands out the plaintext.
"""

import io
import os
import shutil
import tempfile

from django.contrib.auth.models import Permission
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import override_settings
from django.urls import reverse
from django.utils import translation
from django_tenants.test.cases import TenantTestCase
from PIL import Image
from rest_framework.test import APIClient

from consultations.models import Consultation, Message
from core import blobcrypto
from users.models import User

KEY = "k" * 40


def png():
    buffer = io.BytesIO()
    Image.new("RGB", (40, 20), "red").save(buffer, "PNG")
    return buffer.getvalue()


class _EncryptedAttachmentsBase(TenantTestCase):
    def setUp(self):
        self.location = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, self.location)
        self.enterContext(
            override_settings(
                STORAGES={
                    "default": {
                        "BACKEND": "core.storage.EncryptedStorage",
                        "OPTIONS": {"options": {"location": self.location}},
                    },
                    "staticfiles": {
                        "BACKEND": "django.contrib.staticfiles.storage.StaticFilesStorage",
                    },
                },
                BLOB_ENCRYPTION=True,
                BLOB_ENCRYPT_WRITES=True,
                BLOB_ENCRYPTION_KEY=KEY,
                BLOB_ENCRYPTION_OLD_KEY="",
            )
        )
        self.owner = User.objects.create_user(
            email="owner@example.com", is_practitioner=True
        )
        self.consultation = Consultation.objects.create(
            title="Follow-up",
            created_by=self.owner,
            owned_by=self.owner,
            beneficiary=User.objects.create_user(email="pat@example.com"),
        )
        self.api = APIClient()
        self.api.force_authenticate(user=self.owner)

    def attach(self, name, data):
        return Message.objects.create(
            consultation=self.consultation,
            created_by=self.owner,
            attachment=SimpleUploadedFile(name, data),
        )

    def stored(self, message):
        with open(os.path.join(self.location, message.attachment.name), "rb") as raw:
            return raw.read()


class AttachmentApiTests(_EncryptedAttachmentsBase):
    def test_attachment_is_ciphertext_on_disk(self):
        message = self.attach("result.txt", b"histology report")

        stored = self.stored(message)
        self.assertTrue(stored.startswith(blobcrypto.MAGIC))
        self.assertNotIn(b"histology report", stored)

    def test_upload_through_the_api_is_encrypted(self):
        response = self.api.post(
            reverse("consultation-messages", kwargs={"pk": self.consultation.pk}),
            {"attachment": SimpleUploadedFile("scan.pdf", b"%PDF-1.7 scan")},
            format="multipart",
        )

        self.assertEqual(response.status_code, 201, response.content)
        message = Message.objects.get(pk=response.data["id"])
        self.assertTrue(self.stored(message).startswith(blobcrypto.MAGIC))

    def test_download_serves_the_plaintext(self):
        message = self.attach("result.txt", b"histology report")

        response = self.api.get(
            reverse("message_attachment", kwargs={"message_id": message.pk})
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response["Content-Length"], str(len(b"histology report")))
        self.assertEqual(b"".join(response.streaming_content), b"histology report")

    def test_undecryptable_attachment_is_a_404_not_a_500(self):
        message = self.attach("result.txt", b"histology report")

        with override_settings(BLOB_ENCRYPTION_KEY="w" * 40):
            with self.assertLogs("core.storage", "ERROR"):
                response = self.api.get(
                    reverse("message_attachment", kwargs={"message_id": message.pk})
                )

        self.assertEqual(response.status_code, 404)

    def test_pdf_export_still_embeds_image_attachments(self):
        """It used to open attachment.path, which leads to ciphertext."""
        self.attach("photo.png", png())

        response = self.api.get(
            reverse("consultation-export-pdf", kwargs={"pk": self.consultation.pk})
        )

        self.assertEqual(response.status_code, 200)
        self.assertIn(b"/Subtype /Image", response.content)


class AttachmentAdminTests(_EncryptedAttachmentsBase):
    """An encrypted attachment has no URL: the admin links to its own view."""

    def setUp(self):
        super().setUp()
        # Admin URLs carry a language prefix, and outside a request the active
        # language is LANGUAGE_CODE, which is not one the site serves.
        self.enterContext(translation.override("en"))
        self.admin = User.objects.create_superuser(email="admin@example.com")
        self.client.force_login(self.admin)
        self.message = self.attach("result.txt", b"histology report")
        self.download_url = reverse(
            "admin:consultations_message_attachment", args=[self.message.pk]
        )

    def test_consultation_page_links_to_the_download_view(self):
        response = self.client.get(
            reverse(
                "admin:consultations_consultation_change",
                args=[self.consultation.pk],
            )
        )

        self.assertEqual(response.status_code, 200)
        self.assertContains(response, self.download_url)

    def test_message_pages_link_to_the_download_view(self):
        changelist = self.client.get(reverse("admin:consultations_message_changelist"))
        change = self.client.get(
            reverse("admin:consultations_message_change", args=[self.message.pk])
        )

        self.assertContains(changelist, self.download_url)
        self.assertContains(change, self.download_url)

    def test_download_view_serves_the_plaintext_as_a_download(self):
        response = self.client.get(self.download_url)

        self.assertEqual(response.status_code, 200)
        self.assertTrue(response["Content-Disposition"].startswith("attachment"))
        self.assertEqual(b"".join(response.streaming_content), b"histology report")

    def test_read_only_staff_sees_the_consultation(self):
        """Without the change permission every field is rendered read-only,
        and unfold probes the attachment's URL with hasattr()."""
        staff = User.objects.create_user(email="staff@example.com", is_staff=True)
        staff.user_permissions.add(
            *Permission.objects.filter(
                codename__in=["view_consultation", "view_message"]
            )
        )
        self.client.force_login(staff)

        consultation = self.client.get(
            reverse(
                "admin:consultations_consultation_change",
                args=[self.consultation.pk],
            )
        )
        message = self.client.get(
            reverse("admin:consultations_message_change", args=[self.message.pk])
        )

        self.assertContains(consultation, self.download_url)
        self.assertContains(message, self.download_url)
        self.assertEqual(self.client.get(self.download_url).status_code, 200)

    def test_download_view_requires_the_view_permission(self):
        staff = User.objects.create_user(email="staff@example.com", is_staff=True)
        self.client.force_login(staff)

        self.assertEqual(self.client.get(self.download_url).status_code, 403)
