"""FHIR JSON renderer."""
from rest_framework.renderers import JSONRenderer


class FhirJsonRenderer(JSONRenderer):
    """DRF renderer emitting `application/fhir+json`.

    The ViewSet is responsible for shaping the response body (single resource or
    Bundle); this renderer only serializes the dict and announces the proper
    media type.
    """

    media_type = "application/fhir+json"
    format = "fhir"
    charset = "utf-8"
