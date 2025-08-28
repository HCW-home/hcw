
from django.urls import path, include
from rest_framework.routers import DefaultRouter
from . import views

router = DefaultRouter()
router.register(r'specialities', views.SpecialityViewSet)

urlpatterns = [
    path('api/', include(router.urls)),
    path("api/auth/magic-link/request/", views.MagicLinkRequestView.as_view()),
    path("api/auth/magic-link/verify/", views.MagicLinkVerifyView.as_view()),
    path("api/auth/user/consultations/", views.UserConsultationsView.as_view(), name="user_consultations"),
]

