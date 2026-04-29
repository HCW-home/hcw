from django.contrib import admin
from django.shortcuts import redirect
from django.urls import path, reverse
from unfold.admin import ModelAdmin

from . import views
from .models import EncryptionSettings


@admin.register(EncryptionSettings)
class EncryptionSettingsAdmin(ModelAdmin):
    """Anchor admin that exposes the Encryption custom URLs.

    No row of EncryptionSettings is ever created; the changelist URL just
    redirects to the settings page.
    """

    def get_urls(self):
        site = self.admin_site
        custom_urls = [
            path(
                "settings/",
                site.admin_view(views.settings_view_factory(site)),
                name="encryption_settings",
            ),
            path(
                "generate-master/",
                site.admin_view(views.generate_master_view_factory(site)),
                name="encryption_generate_master",
            ),
            path(
                "enable/",
                site.admin_view(views.enable_view_factory(site)),
                name="encryption_enable",
            ),
            path(
                "disable/",
                site.admin_view(views.disable_view_factory(site)),
                name="encryption_disable",
            ),
            path(
                "reprovision/",
                site.admin_view(views.reprovision_view_factory(site)),
                name="encryption_reprovision",
            ),
            path(
                "user-pubkey/<int:user_id>/",
                site.admin_view(views.user_pubkey_view_factory(site)),
                name="encryption_user_pubkey",
            ),
        ]
        return custom_urls + super().get_urls()

    def changelist_view(self, request, extra_context=None):
        return redirect(reverse("admin:encryption_settings"))

    def has_add_permission(self, request):
        return False

    def has_change_permission(self, request, obj=None):
        return False

    def has_delete_permission(self, request, obj=None):
        return False

    def has_view_permission(self, request, obj=None):
        return request.user.is_superuser
