"""Backwards-compatibility shim. The FHIR renderer now lives in `fhir_server`.

Import `fhir_server.renderers.FhirJsonRenderer` directly in new code.
"""
from fhir_server.renderers import FhirJsonRenderer as FHIRRenderer  # noqa: F401

__all__ = ["FHIRRenderer"]
