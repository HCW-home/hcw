from django.contrib import admin, messages
from django.shortcuts import redirect
from django.template.response import TemplateResponse
from django.urls import path, reverse
from unfold.admin import ModelAdmin

from .helpers import get_available_languages, load_translations
from .models import TranslationOverride


@admin.register(TranslationOverride)
class TranslationOverrideAdmin(ModelAdmin):
    list_display = ["component", "language", "key", "value"]
    list_filter = ["component", "language"]
    search_fields = ["key", "value"]

    def get_urls(self):
        custom_urls = [
            path(
                "override-editor/",
                self.admin_site.admin_view(self.override_editor_view),
                name="translations_override_editor",
            ),
        ]
        return custom_urls + super().get_urls()

    def changelist_view(self, request, extra_context=None):
        return redirect(reverse("admin:translations_override_editor"))

    def override_editor_view(self, request):
        components = [c[0] for c in TranslationOverride.COMPONENT_CHOICES]
        component = request.GET.get("component", components[0])
        if component not in components:
            component = components[0]

        available_languages = get_available_languages(component)
        language = request.GET.get("language", available_languages[0] if available_languages else "en")

        if request.method == "POST":
            component = request.POST.get("component", component)
            language = request.POST.get("language", language)
            return self._handle_save(request, component, language)

        # Load translations
        current_translations = load_translations(component, language)
        en_translations = load_translations(component, "en") if language != "en" else {}

        # All keys = union of EN + current language
        all_keys = sorted(set(list(current_translations.keys()) + list(en_translations.keys())))

        # Load existing overrides
        overrides = dict(
            TranslationOverride.objects.filter(
                component=component, language=language
            ).values_list("key", "value")
        )

        # Build rows
        rows = []
        for key in all_keys:
            rows.append({
                "key": key,
                "en_value": en_translations.get(key, ""),
                "current_value": current_translations.get(key, ""),
                "override": overrides.get(key, ""),
            })

        context = {
            **self.admin_site.each_context(request),
            "title": "Translation Overrides",
            "components": components,
            "component": component,
            "languages": available_languages,
            "language": language,
            "rows": rows,
            "show_en_column": language != "en",
            "opts": self.model._meta,
        }
        return TemplateResponse(
            request, "admin/translations/override_list.html", context
        )

    def _handle_save(self, request, component, language):
        keys = request.POST.getlist("key")
        override_values = request.POST.getlist("override")

        to_create_or_update = []
        to_delete_keys = []

        for key, value in zip(keys, override_values):
            stripped = value.strip()
            if stripped:
                to_create_or_update.append(
                    TranslationOverride(
                        component=component,
                        language=language,
                        key=key,
                        value=stripped,
                    )
                )
            else:
                to_delete_keys.append(key)

        # Delete cleared overrides
        if to_delete_keys:
            TranslationOverride.objects.filter(
                component=component, language=language, key__in=to_delete_keys
            ).delete()

        # Upsert overrides
        if to_create_or_update:
            TranslationOverride.objects.bulk_create(
                to_create_or_update,
                update_conflicts=True,
                unique_fields=["component", "language", "key"],
                update_fields=["value"],
            )

        messages.success(request, "Translation overrides saved.")
        url = reverse("admin:translations_override_editor")
        return redirect(f"{url}?component={component}&language={language}")
