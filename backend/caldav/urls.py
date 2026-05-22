from django.urls import path

from . import views

urlpatterns = [
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
