# Encryption at Rest

HCW@Home can encrypt message attachments where they are stored, on the uploads volume or on S3, so that a stolen disk, a leaked backup or a copy of the bucket does not expose them.

!!! note "Not end-to-end encryption"
    This protects the files on the storage medium. The backend holds the key and reads the files as before, which is why nothing changes for users. To hide content from the server itself, see [End-to-End Encryption](../admin/encryption.md). Both can be combined.

## What is encrypted

| Stored item | At rest |
|-------------|---------|
| Message attachments, including those of deleted messages | **Encrypted** |
| Organisation logos, speciality icons, profile pictures | In clear: the frontends and the emails link to them directly |
| Call recordings | In clear: the media server writes them to S3 itself. Rely on the bucket's server-side encryption |
| Database content (messages, follow-ups, users) | Not covered: encrypt the database volume and its backups |

Each file is encrypted with AES-256-GCM in 64 KiB chunks, under its own key derived from `BLOB_ENCRYPTION_KEY`. Attachments are always downloaded through the backend, which decrypts them on the fly: no extra request, no measurable slowdown.

On S3, this complements the bucket's server-side encryption (SSE-S3, SSE-KMS) rather than replacing it: server-side encryption protects the provider's disks, while the key used here never leaves HCW@Home, so a leaked access key or a bucket opened by mistake exposes nothing either.

## Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `BLOB_ENCRYPTION` | `False` | `True` puts the encrypting storage in place: encrypted attachments are decrypted on read. |
| `BLOB_ENCRYPT_WRITES` | value of `BLOB_ENCRYPTION` | `False` keeps writing new attachments in clear while still reading encrypted ones: the intermediate step used to turn encryption on or off without downtime. |
| `BLOB_ENCRYPTION_KEY` | *(none)* | Required with `BLOB_ENCRYPTION=True`. At least 32 characters, and different from `DJANGOSECRET_KEY`. |
| `BLOB_ENCRYPTION_OLD_KEY` | *(none)* | The previous key, still accepted on read during a key rotation. |

The API, the Celery worker and the scheduler must all get the same values. Generate a key with:

```bash
python3 -c "import secrets; print(secrets.token_urlsafe(48))"
```

!!! danger "Keep the key safe"
    There is no recovery: attachments encrypted with a lost key are lost. Keep the key with your backups, but **not in the same place** as the uploads backup, or a stolen backup carries its own key.

## Turning it on

Attachments already stored stay in clear until `encrypt_blobs` converts them. It rewrites each file in place, atomically, and never touches the database: it can be interrupted and run again at any time, files already done are skipped.

1. Set `BLOB_ENCRYPTION=True`, `BLOB_ENCRYPT_WRITES=False` and `BLOB_ENCRYPTION_KEY`, then restart every backend process. Nothing is encrypted yet, but every process can now read encrypted files.
2. Encrypt the attachments already stored:
    ```bash
    python manage.py encrypt_blobs
    ```
3. Set `BLOB_ENCRYPT_WRITES=True` (or remove it), restart, and run `python manage.py encrypt_blobs` once more for the attachments uploaded in between.

The intermediate step matters because processes restart one after the other: one not restarted yet could not read an encrypted file, so nothing gets encrypted before all of them can.

Where to run the command:

=== "Docker Compose"

    ```bash
    docker compose run --rm api python manage.py encrypt_blobs
    ```

=== "Debian"

    ```bash
    cd /usr/share/hcw/backend
    sudo -u hcw sh -c 'set -a; . /etc/hcw/backend.conf; ./venv/bin/python manage.py encrypt_blobs'
    ```

| Option | Effect |
|--------|--------|
| `--dry-run` | List the files that would be converted, change nothing. |
| `--schema <name>` | Only the attachments of one tenant. |
| `--limit <n>` | Stop after converting `n` files. |
| `--old-key <key>` | Also accept this previous key, for this run only. |
| `--decrypt` | Decrypt instead, to turn encryption off. |

A file the command cannot decrypt (unknown key, damaged file) is reported, left untouched, and makes the command exit with an error.

## Rotating the key

1. Move the current key to `BLOB_ENCRYPTION_OLD_KEY`, put a new one in `BLOB_ENCRYPTION_KEY`, restart. New attachments use the new key, both keys are accepted on read.
2. Run `python manage.py encrypt_blobs`: it re-encrypts the attachments still under the old key. Every file records which key encrypted it, so an interrupted run resumes where it stopped.
3. Remove `BLOB_ENCRYPTION_OLD_KEY` and restart.

## Turning it off

1. Set `BLOB_ENCRYPT_WRITES=False`, restart.
2. Decrypt everything:
    ```bash
    python manage.py encrypt_blobs --decrypt
    ```
3. Set `BLOB_ENCRYPTION=False`, restart.

!!! warning "Starting without the key"
    As soon as a storage holds an encrypted file, a `.blob-encryption` file is written at its root. While it exists, `manage.py migrate` and `manage.py check --database default` fail when `BLOB_ENCRYPTION` is off, since attachments would then be served encrypted. `encrypt_blobs --decrypt` removes it once every file is decrypted.

    With a wrong `BLOB_ENCRYPTION_KEY`, attachments encrypted under another key answer 404 and the backend logs `Cannot decrypt stored file ... unknown key`.

## Limits

- Converting the files already stored does not erase their earlier copies: backups and snapshots taken before, previous object versions on a versioned S3 bucket, and the disk blocks the clear files occupied keep the plaintext until they are purged or overwritten.
- File names are not encrypted: the name given at upload (e.g. `blood-test.pdf`) stays readable in the storage path, as does the approximate size of each file.
- Logos, speciality icons and profile pictures stay in clear, see above.
- Call recordings, the database, Redis and logs are not covered by this setting.
