from django.urls import path

from . import views

urlpatterns = [
    path("", views.CalDAVDiscoveryView.as_view(), name="caldav_discovery"),
    path("principal/", views.CalDAVPrincipalView.as_view(), name="caldav_principal"),
    path(
        "calendar/",
        views.CalDAVCalendarView.as_view(),
        name="caldav_calendar",
        kwargs={"filename": None},
    ),
    path(
        "calendar/<str:filename>",
        views.CalDAVCalendarView.as_view(),
        name="caldav_calendar_resource",
    ),
]
