from django.urls import path

from .fhir_routes import get_fhir_viewsets
from .force import ForceFhirMixin
from .views import CapabilityStatementView


def _force_fhir_class(viewset_cls: type) -> type:
    """Build a FHIR-pinned subclass so the forced negotiation never leaks onto
    the original ViewSet's native `/api/<plural>/` routes."""
    return type(f"Fhir{viewset_cls.__name__}", (ForceFhirMixin, viewset_cls), {})


def _build_fhir_urlpatterns():
    # No trailing slash: FHIR canonical convention (`/api/fhir/Appointment`).
    # Since no slashed variant is registered, APPEND_SLASH never redirects.
    patterns = [
        path("fhir/metadata", CapabilityStatementView.as_view(), name="fhir-metadata"),
    ]
    for resource_type, viewset_cls in get_fhir_viewsets().items():
        forced = _force_fhir_class(viewset_cls)
        collection = forced.as_view({
            "get": "list",
            "post": "create",
            "put": "update",       # FHIR conditional update (?identifier=system|value)
            "delete": "destroy",   # FHIR conditional delete
        })
        item = forced.as_view({
            "get": "retrieve",
            "put": "update",
            "patch": "partial_update",
            "delete": "destroy",
        })
        seg = resource_type  # PascalCase resource type == URL segment, verbatim
        patterns += [
            path(f"fhir/{seg}", collection, name=f"fhir-{seg.lower()}-collection"),
            path(f"fhir/{seg}/<pk>", item, name=f"fhir-{seg.lower()}-item"),
        ]
    return patterns


urlpatterns = [
    path("metadata/", CapabilityStatementView.as_view(), name="fhir-capability"),
] + _build_fhir_urlpatterns()
