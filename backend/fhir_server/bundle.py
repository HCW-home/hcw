"""FHIR Bundle builders."""
from django.conf import settings

from .references import build_absolute_url


def _count_total(paginator, queryset):
    mode = getattr(settings, "FHIR_BUNDLE_TOTAL_MODE", "accurate")
    if mode == "none":
        return None
    if paginator is not None and hasattr(paginator, "page") and paginator.page is not None:
        return paginator.page.paginator.count
    try:
        return queryset.count()
    except Exception:
        return None


def build_searchset_bundle(*, request, mapper, instances, paginator=None,
                           queryset=None, include_entries=None) -> dict:
    """Build a FHIR Bundle of type `searchset`.

    Args:
        request: DRF request (used to build absolute `fullUrl` and `link.href`).
        mapper: FhirResourceMapper for the primary resource.
        instances: iterable of Django instances for the current page.
        paginator: DRF pagination instance (optional).
        queryset: original queryset (used for total fallback when paginator absent).
        include_entries: list of (included_mapper, included_instance) tuples
            added to the Bundle with `search.mode = "include"`.

    Returns:
        Bundle dict.
    """
    entries = []
    for instance in instances:
        resource = mapper.to_fhir(instance, context={"request": request})
        entries.append({
            "fullUrl": build_absolute_url(request, mapper.resource_type, instance.pk),
            "resource": resource,
            "search": {"mode": "match"},
        })

    for included_mapper, included_instance in (include_entries or []):
        resource = included_mapper.to_fhir(included_instance, context={"request": request})
        entries.append({
            "fullUrl": build_absolute_url(
                request, included_mapper.resource_type, included_instance.pk
            ),
            "resource": resource,
            "search": {"mode": "include"},
        })

    bundle: dict = {
        "resourceType": "Bundle",
        "type": "searchset",
        "entry": entries,
    }

    total = _count_total(paginator, queryset)
    if total is not None:
        bundle["total"] = total

    links = []
    if request is not None:
        links.append({"relation": "self", "url": request.build_absolute_uri()})
    if paginator is not None:
        next_link = paginator.get_next_link() if hasattr(paginator, "get_next_link") else None
        prev_link = paginator.get_previous_link() if hasattr(paginator, "get_previous_link") else None
        if next_link:
            links.append({"relation": "next", "url": next_link})
        if prev_link:
            links.append({"relation": "previous", "url": prev_link})
    if links:
        bundle["link"] = links

    return bundle


def build_operation_outcome_bundle_entry(outcome: dict, status_code: int) -> dict:
    """Helper for transaction-response bundles (future use)."""
    return {
        "response": {"status": str(status_code)},
        "resource": outcome,
    }
