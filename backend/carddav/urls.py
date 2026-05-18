from django.urls import path

from . import views

urlpatterns = [
    path("", views.CardDAVDiscoveryView.as_view(), name="carddav_discovery"),
    path("principal/", views.CardDAVPrincipalView.as_view(), name="carddav_principal"),
    path(
        "addressbook/",
        views.CardDAVAddressbookView.as_view(),
        name="carddav_addressbook",
        kwargs={"filename": None},
    ),
    path(
        "addressbook/<str:filename>",
        views.CardDAVAddressbookView.as_view(),
        name="carddav_addressbook_resource",
    ),
]