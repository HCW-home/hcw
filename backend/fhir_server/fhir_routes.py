"""Single source of truth for the `/api/fhir/<ResourceType>` aliases.

Maps each FHIR resource type (PascalCase, used verbatim as the URL segment) to
the ViewSet that serves it. Kept explicit on purpose: this is a public API
surface, so exposure is opt-in rather than auto-discovered from the registry.

Imports are deferred inside the function to avoid `AppRegistryNotReady` and
circular imports between `fhir_server` and the `consultations`/`users` apps —
`urls.py` calls this only after Django has loaded all apps.

Adding a new FHIR endpoint = one line here. A guard test asserts no
registry-declared resource type is forgotten (see tests).
"""
from __future__ import annotations


def get_fhir_viewsets() -> dict[str, type]:
    from consultations.views import AppointmentViewSet, ConsultationViewSet
    from users.views import PatientViewSet, PractitionerViewSet

    return {
        "Appointment": AppointmentViewSet,
        "Encounter": ConsultationViewSet,
        "Patient": PatientViewSet,
        "Practitioner": PractitionerViewSet,
        # "MedicationRequest": PrescriptionViewSet,  # enable when the endpoint is exposed
    }
