"""Encryption at rest, seen from the storage API.

Every behaviour is played twice, on the filesystem and on an object store
without local paths standing in for S3: if encryption shows through the
storage API on either, it shows in production.

These are SimpleTestCases on purpose: any database access fails them, which
proves encrypt_blobs never writes to the database and can be rerun freely.
"""

import io
import os
import shutil
import tempfile
from unittest import mock

from django.core.checks import Error
from django.core.files.base import ContentFile
from django.core.files.storage import Storage, storages
from django.core.files.uploadedfile import TemporaryUploadedFile
from django.core.management import CommandError, call_command
from django.http import FileResponse
from django.test import SimpleTestCase, override_settings

from core import blobcrypto
from core.blobcrypto import BlobDecryptionError
from core.checks import check_blob_encryption
from core.storage import SENTINEL_NAME, is_confidential

KEY = "k" * 40
OTHER_KEY = "o" * 40

ATTACHMENT = "tenant1/messages_attachment/report.pdf"
LOGO = "tenant1/organisations/logo.png"
STATICFILES = {"BACKEND": "django.contrib.staticfiles.storage.StaticFilesStorage"}


class ObjectStore(Storage):
    """Stand-in for S3: no local path, save overwrites, one handle per open."""

    def __init__(self):
        self.objects = {}

    def _open(self, name, mode="rb"):
        try:
            return ContentFile(self.objects[name], name=name)
        except KeyError:
            raise FileNotFoundError(name) from None

    def _save(self, name, content):
        # Like S3Storage._save(): rewind only what can be, then read().
        if getattr(content, "seekable", lambda: True)():
            content.seek(0)
        self.objects[name] = content.read()
        return name

    def get_available_name(self, name, max_length=None):
        return name

    def exists(self, name):
        return name in self.objects

    def delete(self, name):
        self.objects.pop(name, None)

    def size(self, name):
        return len(self.objects[name])

    def url(self, name):
        return f"https://bucket.example/{name}"

    def listdir(self, path):
        prefix = f"{path.rstrip('/')}/" if path else ""
        dirs, files = set(), []
        for key in self.objects:
            if key.startswith(prefix):
                head, slash, _ = key[len(prefix) :].partition("/")
                if slash:
                    dirs.add(head)
                else:
                    files.append(head)
        return sorted(dirs), sorted(files)


class _Unsized:
    """Content whose size cannot be known without reading it."""

    def __init__(self, data):
        self._data = io.BytesIO(data)

    def read(self, size=-1):
        return self._data.read(size)


class _EncryptedStorageTestsMixin:
    backend = None

    def backend_options(self):
        return {}

    def setUp(self):
        self.enterContext(
            override_settings(
                STORAGES={
                    "default": {
                        "BACKEND": "core.storage.EncryptedStorage",
                        "OPTIONS": {
                            "backend": self.backend,
                            "options": self.backend_options(),
                        },
                    },
                    "staticfiles": STATICFILES,
                },
                BLOB_ENCRYPTION=True,
                BLOB_ENCRYPT_WRITES=True,
                BLOB_ENCRYPTION_KEY=KEY,
                BLOB_ENCRYPTION_OLD_KEY="",
            )
        )
        self.storage = storages["default"]

    def raw(self, name):
        with self.storage.inner.open(name, "rb") as handle:
            return handle.read()

    def put_raw(self, name, data):
        self.storage.replace_raw(name, ContentFile(data))

    def read(self, name):
        with self.storage.open(name) as handle:
            return handle.read()

    # At rest

    def test_attachment_is_ciphertext_at_rest(self):
        """Without this one, every other test could be testing a no-op."""
        name = self.storage.save(ATTACHMENT, ContentFile(b"hello world"))

        raw = self.raw(name)
        self.assertTrue(raw.startswith(blobcrypto.MAGIC))
        self.assertNotIn(b"hello world", raw)
        self.assertEqual(self.read(name), b"hello world")

    def test_files_published_by_url_stay_in_clear(self):
        name = self.storage.save(LOGO, ContentFile(b"\x89PNG logo"))

        self.assertEqual(self.raw(name), b"\x89PNG logo")
        self.assertTrue(self.storage.url(name))

    def test_attachment_has_no_url(self):
        """An AttributeError: what hasattr() and getattr() with a default
        treat as "no URL", in the admin widgets, templates and DRF."""
        name = self.storage.save(ATTACHMENT, ContentFile(b"data"))

        with self.assertRaises(AttributeError):
            self.storage.url(name)

    def test_attachment_has_no_local_path(self):
        name = self.storage.save(ATTACHMENT, ContentFile(b"data"))

        with self.assertRaises(NotImplementedError):
            self.storage.path(name)

    def test_size_is_the_plaintext_size(self):
        data = os.urandom(blobcrypto.CHUNK_SIZE + 10)
        name = self.storage.save(ATTACHMENT, ContentFile(data))

        self.assertGreater(len(self.raw(name)), len(data))
        self.assertEqual(self.storage.size(name), len(data))
        with self.storage.open(name) as handle:
            self.assertEqual(handle.size, len(data))

    def test_marks_the_storage_on_the_first_encrypted_file(self):
        self.storage.save(LOGO, ContentFile(b"logo"))
        self.assertFalse(self.storage.exists(SENTINEL_NAME))

        self.storage.save(ATTACHMENT, ContentFile(b"data"))
        self.assertTrue(self.storage.exists(SENTINEL_NAME))

    # Reading back

    def test_seeks_across_chunks(self):
        chunk = blobcrypto.CHUNK_SIZE
        data = os.urandom(3 * chunk + 500)
        name = self.storage.save(ATTACHMENT, ContentFile(data))

        with self.storage.open(name) as handle:
            # A range straddling two chunks: the one place offsets can go wrong.
            handle.seek(chunk - 10)
            self.assertEqual(handle.read(20), data[chunk - 10 : chunk + 10])
            handle.seek(-5, io.SEEK_END)
            self.assertEqual(handle.read(), data[-5:])
            self.assertEqual(handle.seek(0, io.SEEK_END), len(data))
            self.assertEqual(handle.read(10), b"")
            handle.seek(2 * chunk)
            self.assertEqual(handle.tell(), 2 * chunk)
            self.assertEqual(handle.read(chunk), data[2 * chunk : 3 * chunk])

    def test_file_response_sends_the_plaintext_and_its_length(self):
        data = os.urandom(2 * blobcrypto.CHUNK_SIZE + 1)
        name = self.storage.save(ATTACHMENT, ContentFile(data))

        response = FileResponse(self.storage.open(name))
        try:
            self.assertEqual(int(response["Content-Length"]), len(data))
            self.assertEqual(b"".join(response.streaming_content), data)
        finally:
            response.close()

    def test_has_no_file_descriptor(self):
        """A WSGI server given one would sendfile() the ciphertext."""
        name = self.storage.save(ATTACHMENT, ContentFile(b"data"))

        with self.storage.open(name) as handle:
            with self.assertRaises(io.UnsupportedOperation):
                handle.fileno()

    def test_reopens_through_the_storage(self):
        name = self.storage.save(ATTACHMENT, ContentFile(b"data"))
        handle = self.storage.open(name)
        handle.read()
        handle.close()

        self.assertEqual(handle.open().read(), b"data")
        handle.close()

    def test_clear_attachment_is_still_served(self):
        """Files stored before encryption stay readable until converted."""
        self.put_raw(ATTACHMENT, b"stored in clear")

        self.assertEqual(self.read(ATTACHMENT), b"stored in clear")
        self.assertEqual(self.storage.size(ATTACHMENT), len(b"stored in clear"))

    def test_writes_off_stores_in_clear_but_still_decrypts(self):
        encrypted = self.storage.save(ATTACHMENT, ContentFile(b"encrypted"))

        with override_settings(BLOB_ENCRYPT_WRITES=False):
            clear = self.storage.save(
                "tenant1/messages_attachment/new.pdf", ContentFile(b"clear")
            )
            self.assertEqual(self.raw(clear), b"clear")
            self.assertEqual(self.read(encrypted), b"encrypted")

    def test_wrong_key_fails_loudly(self):
        name = self.storage.save(ATTACHMENT, ContentFile(b"data"))

        with override_settings(BLOB_ENCRYPTION_KEY=OTHER_KEY):
            with self.assertLogs("core.storage", "ERROR"):
                with self.assertRaisesMessage(BlobDecryptionError, "unknown key"):
                    self.storage.open(name)

    def test_damaged_file_fails_instead_of_serving_noise(self):
        name = self.storage.save(ATTACHMENT, ContentFile(b"medical report"))
        raw = bytearray(self.raw(name))
        raw[blobcrypto.HEADER_SIZE] ^= 1
        self.put_raw(name, bytes(raw))

        with self.storage.open(name) as handle:
            with self.assertRaises(BlobDecryptionError):
                handle.read()

    def test_truncated_file_fails(self):
        name = self.storage.save(ATTACHMENT, ContentFile(os.urandom(1000)))
        self.put_raw(name, self.raw(name)[:-10])

        with self.storage.open(name) as handle:
            with self.assertRaises(BlobDecryptionError):
                handle.read()

    # Writing

    def test_known_size_is_streamed_not_buffered(self):
        with mock.patch("core.storage.tempfile.SpooledTemporaryFile") as spool:
            self.storage.save(ATTACHMENT, ContentFile(b"data"))

        spool.assert_not_called()

    def test_unknown_size_is_buffered_and_said_so(self):
        with self.assertLogs("core.storage", "WARNING"):
            name = self.storage.save(ATTACHMENT, _Unsized(b"no size given"))

        self.assertEqual(self.read(name), b"no size given")

    # encrypt_blobs

    def run_command(self, *args):
        stdout, stderr = io.StringIO(), io.StringIO()
        call_command("encrypt_blobs", *args, stdout=stdout, stderr=stderr)
        return stdout.getvalue()

    def seed_clear_files(self):
        files = {
            ATTACHMENT: b"report",
            "tenant2/messages_attachment/scan.jpg": b"scan",
            # Uploaded before tenants existed.
            "messages_attachment/old.pdf": b"old",
        }
        for name, data in files.items():
            self.put_raw(name, data)
        self.put_raw(LOGO, b"logo")
        return files

    def test_encrypt_blobs_converts_attachments_in_place(self):
        files = self.seed_clear_files()

        output = self.run_command()

        self.assertIn("encrypted: 3", output)
        for name, data in files.items():
            self.assertTrue(self.raw(name).startswith(blobcrypto.MAGIC), name)
            self.assertEqual(self.read(name), data)
        self.assertEqual(self.raw(LOGO), b"logo")
        self.assertTrue(self.storage.exists(SENTINEL_NAME))

    def test_encrypt_blobs_is_idempotent(self):
        self.seed_clear_files()
        self.run_command()
        first = self.raw(ATTACHMENT)

        output = self.run_command()

        self.assertIn("encrypted: 0, already encrypted: 3", output)
        self.assertEqual(self.raw(ATTACHMENT), first)

    def test_encrypt_blobs_dry_run_changes_nothing(self):
        self.seed_clear_files()

        output = self.run_command("--dry-run")

        self.assertIn(f"would encrypt {ATTACHMENT}", output)
        self.assertEqual(self.raw(ATTACHMENT), b"report")
        self.assertFalse(self.storage.exists(SENTINEL_NAME))

    def test_encrypt_blobs_limit_and_schema(self):
        self.seed_clear_files()

        self.run_command("--schema", "tenant2")
        self.assertEqual(self.raw(ATTACHMENT), b"report")
        self.assertTrue(
            blobcrypto.looks_encrypted(self.raw("tenant2/messages_attachment/scan.jpg"))
        )

        self.assertIn("encrypted: 1,", self.run_command("--limit", "1"))

    def test_encrypt_blobs_rotates_the_key(self):
        self.seed_clear_files()
        with override_settings(BLOB_ENCRYPTION_KEY=OTHER_KEY):
            self.run_command()

        with override_settings(BLOB_ENCRYPTION_OLD_KEY=OTHER_KEY):
            # Both keys readable while the rotation runs.
            self.assertEqual(self.read(ATTACHMENT), b"report")
            self.assertIn("encrypted: 3", self.run_command())

        header, _ = blobcrypto.parse_header(self.raw(ATTACHMENT))
        self.assertEqual(header.key_id, blobcrypto.key_id(KEY))
        self.assertEqual(self.read(ATTACHMENT), b"report")

    def test_encrypt_blobs_takes_an_old_key_from_the_command_line(self):
        self.seed_clear_files()
        with override_settings(BLOB_ENCRYPTION_KEY=OTHER_KEY):
            self.run_command()

        self.run_command("--old-key", OTHER_KEY)

        self.assertEqual(self.read(ATTACHMENT), b"report")

    def test_encrypt_blobs_leaves_what_it_cannot_read(self):
        """Never destroy a file no known key opens."""
        self.seed_clear_files()
        with override_settings(BLOB_ENCRYPTION_KEY=OTHER_KEY):
            self.run_command()
        before = self.raw(ATTACHMENT)

        with self.assertRaisesMessage(CommandError, "3 file(s) could not be converted"):
            self.run_command()

        self.assertEqual(self.raw(ATTACHMENT), before)

    def test_encrypt_blobs_decrypts_everything_back(self):
        files = self.seed_clear_files()
        self.run_command()

        with override_settings(BLOB_ENCRYPT_WRITES=False):
            output = self.run_command("--decrypt")

        self.assertIn("decrypted: 3", output)
        for name, data in files.items():
            self.assertEqual(self.raw(name), data)
        self.assertFalse(self.storage.exists(SENTINEL_NAME))

    def test_decrypt_requires_writes_off(self):
        with self.assertRaisesMessage(CommandError, "BLOB_ENCRYPT_WRITES=False"):
            self.run_command("--decrypt")


class FilesystemEncryptionTests(_EncryptedStorageTestsMixin, SimpleTestCase):
    backend = "django.core.files.storage.FileSystemStorage"

    def setUp(self):
        self.location = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, self.location)
        super().setUp()

    def backend_options(self):
        return {"location": self.location}

    def test_large_uploads_are_encrypted_too(self):
        """Uploads above FILE_UPLOAD_MAX_MEMORY_SIZE come as temporary files,
        which FileSystemStorage moves into place as they are when it can."""
        data = os.urandom(3 * 1024 * 1024)
        upload = TemporaryUploadedFile("scan.pdf", "application/pdf", len(data), None)
        self.addCleanup(upload.close)
        upload.write(data)
        upload.flush()

        name = self.storage.save(ATTACHMENT, upload)

        with open(os.path.join(self.location, name), "rb") as stored:
            self.assertTrue(stored.read(8) == blobcrypto.MAGIC)
        self.assertEqual(self.read(name), data)

    def test_public_files_keep_their_path(self):
        name = self.storage.save(LOGO, ContentFile(b"logo"))

        with open(self.storage.path(name), "rb") as stored:
            self.assertEqual(stored.read(), b"logo")

    def test_rewrites_keep_the_file_mode(self):
        self.put_raw(ATTACHMENT, b"report")
        os.chmod(os.path.join(self.location, ATTACHMENT), 0o640)

        self.run_command()

        mode = os.stat(os.path.join(self.location, ATTACHMENT)).st_mode & 0o777
        self.assertEqual(mode, 0o640)

    def test_ignores_leftovers_of_an_interrupted_rewrite(self):
        self.put_raw(ATTACHMENT, b"report")
        leftover = os.path.join(
            self.location, "tenant1/messages_attachment/gone.pdf.hcwcrypt-tmp"
        )
        with open(leftover, "wb") as handle:
            handle.write(b"partial")

        self.assertIn("encrypted: 1,", self.run_command())
        with open(leftover, "rb") as handle:
            self.assertEqual(handle.read(), b"partial")


class ObjectStoreEncryptionTests(_EncryptedStorageTestsMixin, SimpleTestCase):
    backend = "core.tests_encrypted_storage.ObjectStore"

    def test_objects_are_typed_as_opaque_bytes(self):
        """S3 records the Content-Type given at upload: not a PDF anymore."""
        stream = self.storage.encrypted_stream(ContentFile(b"%PDF"), ATTACHMENT)

        self.assertEqual(stream.content_type, "application/octet-stream")
        self.assertFalse(stream.seekable())


class ConfidentialNamesTests(SimpleTestCase):
    def test_attachments_of_any_tenant(self):
        self.assertTrue(is_confidential("tenant1/messages_attachment/a.pdf"))
        self.assertTrue(is_confidential("messages_attachment/from-before-tenants.pdf"))

    def test_files_published_by_url(self):
        self.assertFalse(is_confidential("tenant1/organisations/logo.png"))
        self.assertFalse(is_confidential("tenant1/users/me.jpg"))
        self.assertFalse(is_confidential("tenant1/messages_attachment_old/a.pdf"))


class EncryptionCheckTests(SimpleTestCase):
    """Starting without encryption on a storage holding ciphertext is refused."""

    def setUp(self):
        self.location = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, self.location)
        self.enterContext(
            override_settings(
                STORAGES={
                    "default": {
                        "BACKEND": "django.core.files.storage.FileSystemStorage",
                        "OPTIONS": {"location": self.location},
                    },
                    "staticfiles": STATICFILES,
                },
                BLOB_ENCRYPTION=False,
                BLOB_ENCRYPT_WRITES=False,
            )
        )

    def check(self):
        return check_blob_encryption(None, databases=["default"])

    def mark(self):
        with open(os.path.join(self.location, SENTINEL_NAME), "wb"):
            pass

    def test_clear_storage_passes(self):
        self.assertEqual(self.check(), [])

    def test_encrypted_storage_without_encryption_fails(self):
        self.mark()

        errors = self.check()

        self.assertEqual([type(error) for error in errors], [Error])
        self.assertEqual(errors[0].id, "hcw.E001")

    def test_encrypted_storage_with_encryption_passes(self):
        self.mark()

        with override_settings(BLOB_ENCRYPTION=True):
            self.assertEqual(self.check(), [])

    def test_storage_is_only_reached_when_checks_may(self):
        """Not on every runserver reload: that may be a request to S3."""
        self.mark()

        self.assertEqual(check_blob_encryption(None), [])

    def test_encrypt_blobs_refuses_to_run_without_encryption(self):
        with self.assertRaisesMessage(CommandError, "BLOB_ENCRYPTION is off"):
            call_command("encrypt_blobs", stdout=io.StringIO())
