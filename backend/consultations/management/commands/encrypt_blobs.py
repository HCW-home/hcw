"""
Encrypt the message attachments already stored, rotate their key, or decrypt
them.

EncryptedStorage only encrypts what is written while BLOB_ENCRYPT_WRITES is
on. This command converts the rest in place: same storage, same name, so no
database row changes, and it can be interrupted and run again at any time. It
walks the storage rather than the database, which also covers the attachments
of deleted messages, still stored.

Each file is rewritten atomically: a crash leaves either the old file or the
new one. A file the command cannot decrypt (unknown key, damaged file) is
reported and left untouched.

Rolling encryption out, without downtime:

1. Generate a key, e.g. `python -c "import secrets; print(secrets.token_urlsafe(48))"`,
   and store it with the backups: files encrypted with a lost key are lost.
2. Set BLOB_ENCRYPTION=True, BLOB_ENCRYPT_WRITES=False and BLOB_ENCRYPTION_KEY
   on every backend process (API, Celery worker, scheduler) and restart them.
   Files are still written in clear, but encrypted ones can be read everywhere.
3. `manage.py encrypt_blobs`
4. Set BLOB_ENCRYPT_WRITES=True (or remove it, it follows BLOB_ENCRYPTION),
   restart, then run `manage.py encrypt_blobs` again for the files uploaded
   meanwhile. It skips those already done.

Rotating the key:

1. Move the current key to BLOB_ENCRYPTION_OLD_KEY, put a new one in
   BLOB_ENCRYPTION_KEY, restart: new files use the new key, both are read.
2. `manage.py encrypt_blobs` re-encrypts the files still under the old key.
   The header tells which key a file uses, so an interrupted run resumes
   without decrypting what is already done.
3. Remove BLOB_ENCRYPTION_OLD_KEY and restart.

--old-key accepts a previous key for this run only, e.g. one removed from the
environment before every file was re-encrypted.

Turning encryption off:

1. Set BLOB_ENCRYPT_WRITES=False, restart.
2. `manage.py encrypt_blobs --decrypt`, which removes the sentinel that makes
   `manage.py migrate` refuse to run without encryption, once every file is
   decrypted.
3. Set BLOB_ENCRYPTION=False, restart.
"""

from contextlib import nullcontext

from django.conf import settings
from django.core.files.storage import storages
from django.core.management.base import BaseCommand, CommandError

from core import blobcrypto
from core.storage import CONFIDENTIAL_FOLDERS, TEMPORARY_SUFFIX, EncryptedStorage


class Command(BaseCommand):
    help = (
        "Encrypt the stored message attachments, re-encrypt them under the "
        "current key, or decrypt them (--decrypt)."
    )

    def add_arguments(self, parser):
        parser.add_argument(
            "--decrypt",
            action="store_true",
            help="Decrypt every file, before turning encryption off.",
        )
        parser.add_argument(
            "--old-key",
            help="A previous BLOB_ENCRYPTION_KEY, to re-encrypt the files "
            "written under it.",
        )
        parser.add_argument(
            "--schema", help="Only convert the files of this tenant schema."
        )
        parser.add_argument(
            "--dry-run",
            action="store_true",
            help="List the files that would be converted, change nothing.",
        )
        parser.add_argument(
            "--limit",
            type=int,
            default=0,
            help="Stop after converting this many files (0 = no limit).",
        )

    def handle(self, *args, **options):
        storage = storages["default"]
        if not isinstance(storage, EncryptedStorage):
            raise CommandError(
                "BLOB_ENCRYPTION is off. Turn it on, with its key, on every "
                "backend process first: they must be able to read what this "
                "command writes."
            )
        if options["decrypt"] and settings.BLOB_ENCRYPT_WRITES:
            raise CommandError(
                "Set BLOB_ENCRYPT_WRITES=False and restart first, otherwise "
                "new uploads keep being encrypted."
            )

        old_key = options["old_key"]
        with blobcrypto.using_key(old_key) if old_key else nullcontext():
            self._convert_all(storage, options)

    def _convert_all(self, storage, options):
        decrypt, dry_run, limit = (
            options["decrypt"],
            options["dry_run"],
            options["limit"],
        )
        current_key_id = None if decrypt else blobcrypto.key_id(blobcrypto.current_key())
        if not decrypt and not dry_run:
            # Before the first ciphertext is written, not after the last one.
            storage.mark_encrypted()

        converted = unchanged = failed = 0
        for name in self._confidential_files(storage, options["schema"]):
            if limit and converted >= limit:
                break
            try:
                done = self._convert(storage, name, decrypt, current_key_id, dry_run)
            except FileNotFoundError:
                # Deleted since the listing.
                continue
            except Exception as exc:
                failed += 1
                self.stderr.write(f"{name}: {exc}")
                continue
            if not done:
                unchanged += 1
                continue
            converted += 1
            if dry_run or options["verbosity"] >= 2:
                action = "decrypt" if decrypt else "encrypt"
                self.stdout.write(f"{'would ' if dry_run else ''}{action} {name}")

        verb = "decrypted" if decrypt else "encrypted"
        self.stdout.write(
            self.style.SUCCESS(
                f"{'Would have ' if dry_run else ''}{verb}: {converted}, "
                f"already {verb}: {unchanged}, failed: {failed}"
            )
        )
        if failed:
            raise CommandError(
                f"{failed} file(s) could not be converted, see above. They "
                "were left untouched."
            )

        stopped_early = limit and converted >= limit
        if decrypt and not dry_run:
            if stopped_early or options["schema"]:
                self.stdout.write(
                    "Some files may still be encrypted: the sentinel stays, "
                    "run the command again without --limit and --schema."
                )
            else:
                storage.unmark_encrypted()

    def _confidential_files(self, storage, schema):
        """Every file of a confidential folder, those from before tenants
        included (they sit at the root)."""
        try:
            top_dirs, _ = storage.listdir("")
        except FileNotFoundError:
            return
        for top in sorted(top_dirs):
            if top in CONFIDENTIAL_FOLDERS:
                if schema is None:
                    yield from self._walk(storage, top)
            elif schema is None or top == schema:
                sub_dirs, _ = storage.listdir(top)
                for sub in sorted(sub_dirs):
                    if sub in CONFIDENTIAL_FOLDERS:
                        yield from self._walk(storage, f"{top}/{sub}")

    def _walk(self, storage, directory):
        dirs, files = storage.listdir(directory)
        for file_name in sorted(files):
            # Left behind by an interrupted rewrite: never a stored file.
            if not file_name.endswith(TEMPORARY_SUFFIX):
                yield f"{directory}/{file_name}"
        for sub in sorted(dirs):
            yield from self._walk(storage, f"{directory}/{sub}")

    def _convert(self, storage, name, decrypt, current_key_id, dry_run):
        """Rewrite `name` in the state asked for; False when already in it."""
        with storage.inner.open(name, "rb") as raw:
            head = raw.read(blobcrypto.HEADER_SIZE)
        if blobcrypto.looks_encrypted(head):
            # Raises for a file no known key opens: better left as it is.
            header, _ = blobcrypto.parse_header(head)
            if header.key_id == current_key_id:
                return False
        elif decrypt:
            return False

        if not dry_run:
            with storage.open(name, "rb") as plaintext:
                storage.replace_raw(
                    name,
                    plaintext if decrypt else storage.encrypted_stream(plaintext, name),
                )
        return True
