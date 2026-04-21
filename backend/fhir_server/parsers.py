"""FHIR JSON parser."""
from rest_framework.parsers import JSONParser


class FhirJsonParser(JSONParser):
    """DRF parser for `application/fhir+json` bodies.

    The body is parsed into a plain dict. Validation against a specific FHIR
    resource happens in the mapper's `from_fhir()`.
    """

    media_type = "application/fhir+json"
