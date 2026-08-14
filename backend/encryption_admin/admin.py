from constance.admin import Config, ConstanceAdmin
from constance.forms import ConstanceForm
from django.conf import settings
from django.contrib import admin
from django.shortcuts import redirect
from django.urls import path, reverse
from unfold.admin import ModelAdmin

from . import views
from .models import EncryptionSettings

# Constance fieldsets owned by this app: their keys are only meant to be
# changed through the dedicated Encryption page, which keeps the master key,
# the per-user provisioning and the global toggle in sync. Editing them by
# hand in the live settings would silently break already encrypted data.
HIDDEN_CONSTANCE_FIELDSETS = ("Encryption",)
HIDDEN_CONSTANCE_KEYS = tuple(
    key
    for title in HIDDEN_CONSTANCE_FIELDSETS
    for key in getattr(settings, "CONSTANCE_CONFIG_FIELDSETS", {}).get(title, ())
)


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
            path(
                "master-fingerprint/",
                site.admin_view(views.master_fingerprint_view_factory(site)),
                name="encryption_master_fingerprint",
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


class HiddenKeysConstanceForm(ConstanceForm):
    """Constance form that keeps the encryption keys read-only.

    Their inputs are not rendered any more, so they are missing from the
    POST payload. Marking the fields disabled makes Django fall back to the
    stored value instead of clearing it when another tab is saved.
    """

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        for name in HIDDEN_CONSTANCE_KEYS:
            field = self.fields.get(name)
            if field is not None:
                field.disabled = True


class HiddenKeysConstanceAdmin(ConstanceAdmin):
    """Live settings page without the fieldsets managed elsewhere."""

    change_list_form = HiddenKeysConstanceForm

    def changelist_view(self, request, extra_context=None):
        response = super().changelist_view(request, extra_context)
        context = getattr(response, "context_data", None)
        if not context:
            return response

        if context.get("fieldsets"):
            context["fieldsets"] = [
                fieldset
                for fieldset in context["fieldsets"]
                if fieldset["title"] not in HIDDEN_CONSTANCE_FIELDSETS
            ]
        if context.get("config_values"):
            context["config_values"] = [
                config_value
                for config_value in context["config_values"]
                if config_value["name"] not in HIDDEN_CONSTANCE_KEYS
            ]
        return response


# Constance registers its own admin at import time; swap it for ours.
if admin.site.is_registered(Config):
    admin.site.unregister([Config])
admin.site.register([Config], HiddenKeysConstanceAdmin)
