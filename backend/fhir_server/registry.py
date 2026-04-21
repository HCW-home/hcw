"""Lightweight registry of FHIR resource mappers and their routes.

Populated at first access by walking the DRF URL resolver and collecting
`fhir_class` attributes declared on any view or viewset.
"""
from __future__ import annotations

from dataclasses import dataclass

_CACHE: dict[str, "RegistryEntry"] | None = None


@dataclass
class RegistryEntry:
    resource_type: str
    mapper_class: type
    view_class: type
    basename: str
    path_prefix: str  # e.g. "/api/appointments"


def _walk_urlpatterns(urlpatterns, prefix: str = ""):
    from django.urls import URLPattern, URLResolver

    for entry in urlpatterns:
        if isinstance(entry, URLResolver):
            yield from _walk_urlpatterns(
                entry.url_patterns, prefix + str(entry.pattern)
            )
        elif isinstance(entry, URLPattern):
            yield entry, prefix + str(entry.pattern)


def _extract_view_class(callback):
    if hasattr(callback, "cls"):
        return callback.cls
    if hasattr(callback, "view_class"):
        return callback.view_class
    if hasattr(callback, "view_initkwargs"):
        return getattr(callback, "cls", None)
    return None


def get_registry() -> dict[str, RegistryEntry]:
    global _CACHE
    if _CACHE is not None:
        return _CACHE

    from django.urls import get_resolver

    entries: dict[str, RegistryEntry] = {}
    resolver = get_resolver()
    for pattern, full_path in _walk_urlpatterns(resolver.url_patterns):
        callback = pattern.callback
        view_class = _extract_view_class(callback)
        if view_class is None:
            continue
        mapper_class = getattr(view_class, "fhir_class", None)
        if mapper_class is None:
            continue
        resource_type = getattr(mapper_class, "resource_type", "")
        if not resource_type:
            continue
        # Keep the first match per resource type (list endpoint before detail)
        if resource_type in entries:
            continue
        basename = pattern.name or resource_type.lower()
        entries[resource_type] = RegistryEntry(
            resource_type=resource_type,
            mapper_class=mapper_class,
            view_class=view_class,
            basename=basename,
            path_prefix="/" + full_path.strip("^$/"),
        )
    _CACHE = entries
    return _CACHE


def reset_registry():
    """Clear the cache (useful for tests)."""
    global _CACHE
    _CACHE = None
