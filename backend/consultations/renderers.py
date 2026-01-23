from rest_framework.renderers import JSONRenderer
import json

class FHIRRenderer(JSONRenderer):
    media_type = 'application/json'
    format = 'fhir'

    def render(self, data, accepted_media_type=None, renderer_context=None):
        view = renderer_context.get('view') if renderer_context else None
        fhir_class = getattr(view, 'fhir_class', None)

        if fhir_class and data:
            if isinstance(data, dict) and 'results' in data:
                data['results'] = [
                    fhir_class(item).to_fhir() for item in data['results']
                ]

            elif isinstance(data, dict):
                data = fhir_class(data).to_fhir()

        return super().render(data, accepted_media_type, renderer_context)

