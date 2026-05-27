from django.urls import path

from . import views

urlpatterns = [
    path("", views.DAVDiscoveryView.as_view(), name="dav_discovery"),
    path("principal/", views.DAVPrincipalView.as_view(), name="dav_principal"),
]