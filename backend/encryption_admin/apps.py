from django.apps import AppConfig


class EncryptionAdminConfig(AppConfig):
    default_auto_field = "django.db.models.BigAutoField"
    name = "encryption_admin"
    verbose_name = "Encryption"

    def ready(self):
        from . import signals  # noqa: F401
