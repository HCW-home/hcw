"""FHIR metadata/CapabilityStatement view."""
from __future__ import annotations

from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView

from .registry import get_registry
from .renderers import FhirJsonRenderer


class CapabilityStatementView(APIView):
    """Expose the server's CapabilityStatement at /api/metadata/.

    The statement is auto-built by introspecting the URL router for ViewSets
    declaring a `fhir_class` attribute.
    """

    permission_classes = [AllowAny]
    authentication_classes: list = []
    renderer_classes = [FhirJsonRenderer]

    def get(self, request, *args, **kwargs):
        resources = []
        for entry in get_registry().values():
            mapper = entry.mapper_class()
            interactions = [
                {"code": code} for code in entry.view_class.fhir_interactions()
            ] if hasattr(entry.view_class, "fhir_interactions") else []
            search_params = [
                {
                    "name": name,
                    "type": param.type,
                    "documentation": getattr(param, "documentation", "") or "",
                }
                for name, param in (getattr(mapper, "search_params", {}) or {}).items()
            ]
            profile_urls = list(getattr(mapper, "profile_urls", []) or [])
            resource_entry = {
                "type": entry.resource_type,
                "interaction": interactions,
                "searchParam": search_params,
            }
            if profile_urls:
                resource_entry["profile"] = profile_urls[0]
                if len(profile_urls) > 1:
                    resource_entry["supportedProfile"] = profile_urls[1:]
            resources.append(resource_entry)

        capability = {
            "resourceType": "CapabilityStatement",
            "status": "active",
            "date": "",
            "kind": "instance",
            "fhirVersion": "4.0.1",
            "format": ["application/fhir+json"],
            "rest": [{
                "mode": "server",
                "resource": resources,
            }],
        }
        return Response(capability)
