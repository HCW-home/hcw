"""Reference and identifier helpers for FHIR resources."""
from django.conf import settings
from django.db import connection

_DEFAULT_BASE_URL = "https://hcw.example/fhir"


def get_system_base_url() -> str:
    """Return the canonical FHIR system base URL for the current tenant."""
    per_tenant = getattr(settings, "FHIR_SYSTEM_BASE_URL_BY_TENANT", {}) or {}
    tenant = getattr(connection, "tenant", None)
    schema = getattr(tenant, "schema_name", None)
    if schema and schema in per_tenant:
        return per_tenant[schema].rstrip("/")
    return getattr(settings, "FHIR_SYSTEM_BASE_URL", _DEFAULT_BASE_URL).rstrip("/")


def get_identifier_system(resource_type: str) -> str:
    """Return the Identifier.system URL for a given FHIR resource type."""
    mapping = getattr(settings, "FHIR_IDENTIFIER_SYSTEMS", {}) or {}
    if resource_type in mapping:
        return mapping[resource_type]
    base = get_system_base_url()
    return f"{base}/ns/{resource_type.lower()}-id"


def build_identifier(resource_type: str, value, *, use: str = "official") -> dict:
    """Build a FHIR Identifier dict for the HCW canonical system."""
    return {
        "use": use,
        "system": get_identifier_system(resource_type),
        "value": str(value),
    }


def build_reference(resource_type: str, pk, *, display: str | None = None) -> dict | None:
    """Build a relative FHIR Reference dict."""
    if pk is None:
        return None
    ref = {"reference": f"{resource_type}/{pk}"}
    if display:
        ref["display"] = display
    return ref


def parse_reference(ref: str) -> tuple[str | None, str | None]:
    """Parse a FHIR reference string into (resource_type, id).

    Accepts relative forms like "Patient/123" and absolute URLs ending with
    "/ResourceType/id". Returns (None, None) on failure.
    """
    if not ref:
        return None, None
    # Strip absolute URL prefix if present
    if "://" in ref:
        ref = ref.split("/", 3)[-1] if ref.count("/") >= 3 else ref
    parts = ref.strip("/").split("/")
    if len(parts) < 2:
        return None, None
    return parts[-2], parts[-1]


def build_absolute_url(request, resource_type: str, pk) -> str:
    """Return an absolute URL for a Bundle entry fullUrl."""
    if pk is None:
        return ""
    if request is not None:
        base = request.build_absolute_uri("/").rstrip("/")
        return f"{base}/api/{resource_type}/{pk}"
    return f"{get_system_base_url()}/{resource_type}/{pk}"
