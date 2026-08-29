"""
URL configuration for core project.

The `urlpatterns` list routes URLs to views. For more information please see:
    https://docs.djangoproject.com/en/5.1/topics/http/urls/
Examples:
Function views
    1. Add an import:  from my_app import views
    2. Add a URL to urlpatterns:  path('', views.home, name='home')
Class-based views
    1. Add an import:  from other_app.views import Home
    2. Add a URL to urlpatterns:  path('', Home.as_view(), name='home')
Including another URLconf
    1. Import the include() function: from django.urls import include, path
    2. Add a URL to urlpatterns:  path('blog/', include('blog.urls'))
"""
import re

from django.contrib import admin
from django.urls import path, include
from django.conf import settings
from django.conf.urls.static import static
from django.conf.urls.i18n import i18n_patterns
from django.http import Http404
from django.views.static import serve

from core.views import LoginSelectorView

# "<schema>/messages_attachment/<file>", as written by TenantUploadTo.
_ATTACHMENT_PATH = re.compile(r"^[^/]+/messages_attachment/")


def debug_media_serve(request, path, document_root=None, **kwargs):
    """Dev-only media server that keeps message attachments out.

    Django's static serve has no notion of who may read a file, and an
    attachment is medical content, so under DEBUG the whole MEDIA_ROOT would
    otherwise be readable by path without authentication. The only way to an
    attachment stays `MessageAttachmentView`, which checks consultation access.
    """
    if _ATTACHMENT_PATH.match(path):
        raise Http404("Message attachments are served by the API only.")
    return serve(request, path, document_root=document_root, **kwargs)


urlpatterns = [
    path("", LoginSelectorView.as_view(), name="login_selector"),
    path("i18n/", include("django.conf.urls.i18n")),
    path("accounts/", include("allauth.urls")),
    path('api/', include('api.urls')),
    path('api/', include('translations.urls')),
    path('', include('django.contrib.auth.urls')),
    path('', include('users.urls')),
    path('', include('consultations.urls')),
    path('', include('messaging.urls')),
    path('dav/', include('dav.urls')),
    path('dav/', include('caldav.urls')),
    path('dav/', include('carddav.urls')),
] + i18n_patterns(path('admin/', admin.site.urls))

if settings.DEBUG:
    urlpatterns += static(
        settings.MEDIA_URL,
        document_root=settings.MEDIA_ROOT,
        view=debug_media_serve,
    )


