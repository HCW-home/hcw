from django.contrib import admin, messages
from django.http import HttpResponseRedirect
from django.urls import path
from django.utils.html import format_html
from unfold.admin import ModelAdmin
from unfold.decorators import display
from .models import Configuration

@admin.register(Configuration)
class ConfigurationAdmin(ModelAdmin):
    list_display = ['key', 'value_preview', 'description_preview', 'is_modified_indicator', 'updated_at']
    list_filter = ['is_default', 'created_at', 'updated_at']
    search_fields = ['key', 'value', 'description']
    readonly_fields = ['created_at', 'updated_at', 'is_default']
    
    fieldsets = (
        (None, {
            'fields': ('key', 'value', 'description')
        }),
        ('System Info', {
            'fields': ('is_default', 'created_at', 'updated_at'),
            'classes': ('collapse',)
        }),
    )

    # Remove delete actions
    actions = ['reset_selected_to_default']
    
    def has_delete_permission(self, request, obj=None):
        return False

    def get_actions(self, request):
        actions = super().get_actions(request)
        if 'delete_selected' in actions:
            del actions['delete_selected']
        return actions

    @display(description="Value")
    def value_preview(self, obj):
        return obj.value[:100] + "..." if len(obj.value) > 100 else obj.value

    @display(description="Description")
    def description_preview(self, obj):
        return obj.description[:50] + "..." if len(obj.description) > 50 else obj.description

    @display(description="Modified", boolean=True)
    def is_modified_indicator(self, obj):
        return obj.is_modified_from_default()

    def reset_selected_to_default(self, request, queryset):
        reset_count = 0
        failed_count = 0
        
        for config in queryset:
            result = Configuration.reset_to_default(config.key)
            if result:
                reset_count += 1
            else:
                failed_count += 1
        
        if reset_count > 0:
            messages.success(
                request, 
                f"Successfully reset {reset_count} configuration(s) to default values."
            )
        if failed_count > 0:
            messages.warning(
                request,
                f"Failed to reset {failed_count} configuration(s) - no default values defined."
            )

    reset_selected_to_default.short_description = "Reset selected configurations to default values"

    def get_urls(self):
        urls = super().get_urls()
        custom_urls = [
            path(
                '<int:object_id>/reset/',
                self.admin_site.admin_view(self.reset_single_view),
                name='configuration_configuration_reset',
            ),
        ]
        return custom_urls + urls

    def reset_single_view(self, request, object_id):
        try:
            config = Configuration.objects.get(pk=object_id)
            result = Configuration.reset_to_default(config.key)
            if result:
                messages.success(request, f"Configuration '{config.key}' has been reset to default value.")
            else:
                messages.error(request, f"No default value defined for '{config.key}'.")
        except Configuration.DoesNotExist:
            messages.error(request, "Configuration not found.")
        
        return HttpResponseRedirect(f"/admin/configuration/configuration/{object_id}/change/")
