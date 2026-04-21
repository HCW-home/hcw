"""Content negotiation that honors `?format=fhir` regardless of Accept.

DRF's default negotiation combines `?format=` and the `Accept` header with a
logical AND — so a Swagger request with `Accept: application/json` and
`?format=fhir` returns 406 because `application/fhir+json` does not match
`application/json`. This class short-circuits: when the client opts in via the
format query param (or a FHIR Accept header), the FHIR renderer wins.
"""
from rest_framework.negotiation import DefaultContentNegotiation

from .renderers import FhirJsonRenderer


class FhirContentNegotiation(DefaultContentNegotiation):

    def select_renderer(self, request, renderers, format_suffix=None):
        requested_format = format_suffix or request.query_params.get(
            self.settings.URL_FORMAT_OVERRIDE
        )
        if requested_format == "fhir":
            fhir_renderer = next(
                (r for r in renderers if isinstance(r, FhirJsonRenderer)),
                None,
            )
            if fhir_renderer is not None:
                return fhir_renderer, fhir_renderer.media_type

        # Explicit FHIR Accept takes precedence over generic */*.
        accepts = self.get_accept_list(request)
        if any("application/fhir+json" in a for a in accepts):
            fhir_renderer = next(
                (r for r in renderers if isinstance(r, FhirJsonRenderer)),
                None,
            )
            if fhir_renderer is not None:
                return fhir_renderer, fhir_renderer.media_type

        return super().select_renderer(request, renderers, format_suffix)
