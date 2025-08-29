
from django.urls import path, include
from rest_framework.routers import DefaultRouter
from . import views
from consultations.views import BookingSlotViewSet

router = DefaultRouter()
router.register(r'specialities', views.SpecialityViewSet)

# Create a separate router for user-specific endpoints
user_router = DefaultRouter()
user_router.register(r'bookingslots', BookingSlotViewSet, basename='user-bookingslots')

urlpatterns = [
    path('api/', include(router.urls)),
    path("api/auth/magic-link/request/", views.MagicLinkRequestView.as_view()),
    path("api/auth/magic-link/verify/", views.MagicLinkVerifyView.as_view()),
    path("api/user/consultations/", views.UserConsultationsView.as_view(), name="user_consultations"),
    path("api/user/notifications/", views.UserNotificationsView.as_view(), name="user_notifications"),
    path("api/user/appointments/", views.UserAppointmentsView.as_view(), name="user_appointments"),
    path("api/user/healthmetrics/", views.UserHealthMetricsView.as_view(), name="user_healthmetrics"),
    path('api/user/', include(user_router.urls)),
]

