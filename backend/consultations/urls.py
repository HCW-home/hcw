from django.urls import include, path
from rest_framework.routers import DefaultRouter

from .views import (
    AppointmentViewSet,
    ConsultationViewSet,
    MessageViewSet,
    ParticipantViewSet,
    QueueViewSet,
    ReasonSlotsView,
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

urlpatterns = [
    path("api/", include(router.urls)),
    path("api/reasons/<int:id>/slots/", ReasonSlotsView.as_view(), name="reason_slots"),
]
