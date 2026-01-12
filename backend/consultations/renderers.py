from rest_framework.renderers import BaseRenderer
import json

class FHIRRenderer(BaseRenderer):
    media_type = 'application/fhir+json'  # ou application/fhir+xml
    format = 'fhir'

    def render(self, data, media_type=None, renderer_context=None):
        view = renderer_context.get('view') if renderer_context else None
        fhir_obj = view.fhir_class(data)
        return fhir_obj.to_representation()
