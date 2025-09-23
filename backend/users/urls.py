
from django.urls import path, include
from rest_framework.routers import DefaultRouter
from . import views
from consultations.views import BookingSlotViewSet

router = DefaultRouter()
router.register(r'languages', views.LanguageViewSet)
router.register(r'specialities', views.SpecialityViewSet)
router.register(r'users', views.UserViewSet)

# Create a separate router for user-specific endpoints
user_router = DefaultRouter()
user_router.register(r'bookingslots', BookingSlotViewSet, basename='user-bookingslots')
user_router.register(r'appointments', views.UserAppointmentViewSet, basename='user-appointments')
user_router.register(r'consultations', views.UserConsultationsViewSet, basename='user-consultations')

urlpatterns = [
    path('api/', include(router.urls)),
    path('api/auth/openid/', views.OpenIDView.as_view(), name='openid_login'),
    path("api/user/notifications/", views.UserNotificationsView.as_view(), name="user_notifications"),
    path("api/user/appointments/", views.UserAppointmentsView.as_view(), name="user_appointments"),
    path("api/user/healthmetrics/", views.UserHealthMetricsView.as_view(), name="user_healthmetrics"),
    path("api/messages/<int:message_id>/attachment/", views.MessageAttachmentView.as_view(), name="message_attachment"),
    path('api/user/', include(user_router.urls)),
]

