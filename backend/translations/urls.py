from django.urls import path

from .views import TranslationOverrideView

urlpatterns = [
    path(
        "translations/<str:component>/<str:language>/",
        TranslationOverrideView.as_view(),
        name="translation-overrides",
    ),
]
