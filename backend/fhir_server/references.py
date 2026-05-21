"""Reference and identifier helpers for FHIR resources."""
from functools import lru_cache

from django.conf import settings
from django.db import connection

_DEFAULT_BASE_URL = "https://hcw.example"


@lru_cache(maxsize=256)
def _derive_base_from_schema(schema: str) -> str | None:
    """Build the FHIR base URL from the tenant's primary Domain row.

    Cached per process — Domain mutations are rare; restart the server to
    refresh after editing a tenant's domain.
    """
    try:
        from tenants.models import Domain
    except ImportError:
        return None
    domain = (
        Domain.objects.filter(tenant__schema_name=schema, is_primary=True).first()
        or Domain.objects.filter(tenant__schema_name=schema).first()
    )
    if domain is None:
        return None
    scheme = getattr(settings, "FHIR_SYSTEM_SCHEME", "https")
    path = getattr(settings, "FHIR_SYSTEM_PATH", "/fhir").rstrip("/")
    return f"{scheme}://{domain.domain}{path}"


def get_system_base_url() -> str:
    """Return the canonical FHIR system base URL for the current tenant.

    Resolution order:
    1. Explicit per-tenant override (`FHIR_SYSTEM_BASE_URL_BY_TENANT[schema]`).
    2. Explicit global override (`FHIR_SYSTEM_BASE_URL`).
    3. Auto-derived from `connection.tenant`'s primary Domain row.
    4. Hard-coded fallback (only hit outside a tenant context — management
       commands, migrations, or the public schema).
    """
    tenant = getattr(connection, "tenant", None)
    schema = getattr(tenant, "schema_name", None)

    per_tenant = getattr(settings, "FHIR_SYSTEM_BASE_URL_BY_TENANT", {}) or {}
    if schema and schema in per_tenant:
        return per_tenant[schema].rstrip("/")

    static_url = getattr(settings, "FHIR_SYSTEM_BASE_URL", None)
    if static_url:
        return static_url.rstrip("/")

    if schema:
        derived = _derive_base_from_schema(schema)
        if derived:
            return derived.rstrip("/")

    return _DEFAULT_BASE_URL


def get_identifier_system(resource_type: str) -> str:
    """Return the Identifier.system URL for a given FHIR resource type."""
    mapping = getattr(settings, "FHIR_IDENTIFIER_SYSTEMS", {}) or {}
    if resource_type in mapping:
        return mapping[resource_type]
    base = get_system_base_url()
    return f"{base}/ns/{resource_type.lower()}-id"


def get_external_identifier_system(resource_type: str) -> str | None:
    """Return the external (third-party) Identifier.system URL for a resource.

    The URL lives in the current tenant's Constance config — empty string
    means "no external system configured for this resource". Lookup table
    (resource → Constance key) is held in settings to keep the mapping
    declarative.
    """
    keys = getattr(settings, "FHIR_EXTERNAL_IDENTIFIER_CONSTANCE_KEYS", {}) or {}
    key = keys.get(resource_type)
    if not key:
        return None
    try:
        from constance import config as constance_config
        value = getattr(constance_config, key, None)
    except Exception:
        return None
    return value or None


def split_token(raw_value: str) -> tuple[str | None, str]:
    """Split a FHIR token `[system|]value` into (system, value).

    No pipe → (None, value): unqualified token.
    Empty system → ("", value) caller treats as "canonical-only".
    """
    if "|" not in raw_value:
        return None, raw_value
    system, _, value = raw_value.partition("|")
    return system, value


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
