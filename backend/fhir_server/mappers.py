"""Base class for bidirectional FHIR resource mappers."""
from typing import Any

from django.utils import timezone

from .references import build_identifier


class FhirResourceMapper:
    """Map between a Django model instance and a FHIR R4 resource dict.

    Subclasses declare `resource_type`, `model` and a `search_params` dict, then
    implement `to_fhir(instance)` and optionally `from_fhir(payload, instance)`.
    """

    resource_type: str = ""
    model: Any = None
    profile_urls: list[str] = []
    search_params: dict = {}
    include_targets: dict[str, str] = {}
    revinclude_targets: dict[str, "FhirResourceMapper"] = {}

    def to_fhir(self, instance, *, context: dict | None = None) -> dict:
        raise NotImplementedError

    def from_fhir(self, payload: dict, instance=None, *, context: dict | None = None):
        raise NotImplementedError(
            f"{self.__class__.__name__} does not support inbound FHIR payloads"
        )

    def build_identifiers(self, instance) -> list[dict]:
        pk = getattr(instance, "pk", None)
        if pk is None:
            return []
        return [build_identifier(self.resource_type, pk)]

    def build_meta(self, instance) -> dict:
        last_updated = self._resolve_last_updated(instance)
        version_id = self._resolve_version_id(instance, last_updated)
        meta: dict = {}
        if version_id:
            meta["versionId"] = str(version_id)
        if last_updated is not None:
            meta["lastUpdated"] = self._format_datetime(last_updated)
        if self.profile_urls:
            meta["profile"] = list(self.profile_urls)
        return meta

    def build_narrative(self, instance) -> dict | None:
        return None

    # -- helpers ----------------------------------------------------------

    def _resolve_last_updated(self, instance):
        for field in ("updated_at", "modified_at", "created_at"):
            value = getattr(instance, field, None)
            if value is not None:
                return value
        return None

    def _resolve_version_id(self, instance, last_updated) -> str:
        if last_updated is not None and hasattr(last_updated, "timestamp"):
            try:
                return str(int(last_updated.timestamp() * 1000))
            except (ValueError, OSError):
                pass
        return str(getattr(instance, "pk", "") or "")

    def _format_datetime(self, value):
        if value is None:
            return None
        if hasattr(value, "isoformat"):
            if hasattr(value, "tzinfo") and value.tzinfo is None:
                value = timezone.make_aware(value)
            return value.isoformat()
        return str(value)

    def etag_for(self, instance) -> str:
        """Return the weak ETag to expose on responses for this instance."""
        meta = self.build_meta(instance)
        version = meta.get("versionId") or ""
        return f'W/"{version}"'

    def last_modified_for(self, instance):
        return self._resolve_last_updated(instance)
