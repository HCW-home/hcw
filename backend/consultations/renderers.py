from rest_framework.renderers import BaseRenderer
import json

class FHIRRenderer(BaseRenderer):
    media_type = 'application/fhir+json'  # ou application/fhir+xml
    format = 'fhir'

    def render(self, data, media_type=None, renderer_context=None):
        print(data)
        view = renderer_context.get('view') if renderer_context else None
        print(view.serializer_class)
        # Transformer en format FHIR
        return json.dumps(data, default=str).encode('utf-8')