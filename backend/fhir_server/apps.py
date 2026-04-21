from django.apps import AppConfig


class FhirServerConfig(AppConfig):
    default_auto_field = "django.db.models.BigAutoField"
    name = "fhir_server"
    verbose_name = "FHIR Server"
