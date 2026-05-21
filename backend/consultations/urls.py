from django.urls import include, path
from rest_framework.routers import DefaultRouter

from .views import (
    AppointmentViewSet,
    ConsultationViewSet,
    CustomFieldViewSet,
    DashboardPractitionerView,
    MessageViewSet,
    ParticipantViewSet,
    # PrescriptionViewSet,
    QueueViewSet,
    ReasonSlotsView,
    ReasonViewSet,
    RequestViewSet,
)

# DRF router configuration
router = DefaultRouter()
router.register(r"consultations", ConsultationViewSet, basename="consultation")
router.register(r"appointments", AppointmentViewSet, basename="appointment")
router.register(r"participants", ParticipantViewSet, basename="participant")
router.register(r"queues", QueueViewSet, basename="queue")
router.register(r"requests", RequestViewSet, basename="request")
router.register(r"messages", MessageViewSet, basename="message")
router.register(r"reasons", ReasonViewSet, basename="reason")
router.register(r"custom-fields", CustomFieldViewSet, basename="custom-field")
# router.register(r"prescriptions", PrescriptionViewSet, basename="prescription")

urlpatterns = [
    # FHIR conditional operations: PUT/DELETE on the collection URL using
    # `?identifier=system|value` to address the target. Listed before the
    # router include so the explicit path wins.
    path(
        "api/appointments/",
        AppointmentViewSet.as_view({
            "get": "list",
            "post": "create",
            "put": "update",
            "delete": "destroy",
        }),
        name="appointment-conditional",
    ),
    path(
        "api/consultations/",
        ConsultationViewSet.as_view({
            "get": "list",
            "post": "create",
            "put": "update",
            "delete": "destroy",
        }),
        name="consultation-conditional",
    ),
    path("api/", include(router.urls)),
    path("api/reasons/<int:id>/slots/", ReasonSlotsView.as_view(), name="reason_slots"),
    path("api/dashboard/", DashboardPractitionerView.as_view(), name="dashboard_practitioner"),
]
