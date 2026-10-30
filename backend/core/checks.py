from django.conf import settings
from django.core.checks import Error, Tags, Warning, register
from django.core.files.storage import default_storage

from core.storage import SENTINEL_NAME


@register(Tags.security)
def check_blob_encryption(app_configs, databases=None, **kwargs):
    """Refuse a storage holding encrypted files while encryption is off.

    Without EncryptedStorage in front of it, every encrypted attachment would
    be served as ciphertext. The sentinel is written by the first encrypted
    save and by encrypt_blobs, and only removed by `encrypt_blobs --decrypt`.

    Looking for it may cost a request to S3, so like Django's database checks
    this only runs when checks may reach external services: on migrate, on
    test runs, and on `check --database default`. Not on every runserver
    reload.
    """
    if not databases or settings.BLOB_ENCRYPTION:
        return []
    try:
        encrypted = default_storage.exists(SENTINEL_NAME)
    except Exception as exc:
        return [
            Warning(
                f"Could not check whether stored files are encrypted: {exc}",
                id="hcw.W001",
            )
        ]
    if not encrypted:
        return []
    return [
        Error(
            "Stored files are encrypted at rest but BLOB_ENCRYPTION is off: "
            "encrypted attachments would be served undecrypted.",
            hint=(
                "Set BLOB_ENCRYPTION=True with the BLOB_ENCRYPTION_KEY they "
                "were encrypted with, or run `manage.py encrypt_blobs "
                "--decrypt` before turning encryption off."
            ),
            id="hcw.E001",
        )
    ]
