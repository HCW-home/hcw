from django.urls import path, include
from rest_framework.routers import DefaultRouter
from .views import (
    ConsultationViewSet, 
    GroupViewSet,
    RequestViewSet
)

# DRF router configuration
router = DefaultRouter()
router.register(r'consultations', ConsultationViewSet, basename='consultation')
router.register(r'groups', GroupViewSet, basename='group')
router.register(r'requests', RequestViewSet, basename='request')

urlpatterns = [
    path('api/', include(router.urls)),
]