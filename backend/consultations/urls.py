from django.urls import path, include
from rest_framework.routers import DefaultRouter
from .views import (
    ConsultationViewSet, 
    GroupViewSet, 
    AppointmentViewSet,
    ParticipantViewSet,
    MessageViewSet
)

# DRF router configuration
router = DefaultRouter()
router.register(r'consultations', ConsultationViewSet, basename='consultation')
router.register(r'groups', GroupViewSet, basename='group')
# router.register(r'appointments', AppointmentViewSet, basename='appointment')
# router.register(r'participants', ParticipantViewSet, basename='participant')
# router.register(r'messages', MessageViewSet, basename='message')

urlpatterns = [
    path('api/', include(router.urls)),
]