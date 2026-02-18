from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView

from .models import TranslationOverride


class TranslationOverrideView(APIView):
    permission_classes = [AllowAny]

    def get(self, request, component, language):
        overrides = TranslationOverride.objects.filter(
            component=component, language=language
        ).values_list("key", "value")
        return Response(dict(overrides))
