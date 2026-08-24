from django.urls import path

from . import views

urlpatterns = [
    # No trailing slash: a WhatsApp button URL can only carry its variable as
    # the very last character of the URL.
    path("r/<str:token>", views.message_redirect, name="message_redirect"),
    path(
        "messaging/twilio/status/<str:token>",
        views.twilio_status_callback,
        name="twilio_status_callback",
    ),
]
