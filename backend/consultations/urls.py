from django.urls import path, include
from rest_framework.routers import DefaultRouter
from .views import (
    ConsultationViewSet, 
    GroupViewSet
)

# DRF router configuration
router = DefaultRouter()
router.register(r'consultations', ConsultationViewSet, basename='consultation')
router.register(r'groups', GroupViewSet, basename='group')

urlpatterns = [
    path('api/', include(router.urls)),
]