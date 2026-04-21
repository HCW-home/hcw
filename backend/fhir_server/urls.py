from django.urls import path

from .views import CapabilityStatementView

urlpatterns = [
    path("metadata/", CapabilityStatementView.as_view(), name="fhir-capability"),
]
