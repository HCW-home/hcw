"""Force FHIR mode on a ViewSet, regardless of `?format` or `Accept`.

Bound only to the `/api/fhir/*` alias routes (see `urls.py`). Pins the FHIR
renderer during content negotiation so `is_fhir_request()` is True without the
client opting in via `?format=fhir` or an `application/fhir+json` Accept header.

Applied via a dynamically-built subclass so the original ViewSet keeps its
native JSON behaviour on its existing `/api/<plural>/` routes.
"""
from __future__ import annotations

from .renderers import FhirJsonRenderer


class ForceFhirMixin:
    """Pin the FHIR renderer so the request is always treated as FHIR.

    `is_fhir_request()` (fhir_server/exceptions.py) returns True as soon as
    `request.accepted_renderer.format == "fhir"`. DRF sets `accepted_renderer`
    in `initial()` via `perform_content_negotiation()`; overriding that single
    hook is enough to force FHIR for every action (list/retrieve/create/update/
    destroy), the bundle builder, and the FHIR exception handler.
    """

    force_fhir = True

    def perform_content_negotiation(self, request, force=False):
        renderers = self.get_renderers()
        fhir = next(
            (r for r in renderers if isinstance(r, FhirJsonRenderer)), None
        ) or FhirJsonRenderer()
        return (fhir, fhir.media_type)
