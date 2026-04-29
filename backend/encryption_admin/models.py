from django.db import models


class EncryptionSettings(models.Model):
    """Anchor model for the Encryption admin pages.

    The actual encryption settings live in constance (toggle, master pubkey)
    and on the User / Queue / Consultation tables. This empty model only
    exists so the admin can register a ModelAdmin and expose custom URLs
    under the `admin:encryption_*` namespace.
    """

    class Meta:
        verbose_name = "Encryption"
        verbose_name_plural = "Encryption"
        default_permissions = ()
