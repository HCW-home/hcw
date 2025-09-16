from typing import DefaultDict
from django.contrib import admin
from .models import MessagingProvider, Prefix, Message, MessageStatus, Template, TemplateValidation, TemplateValidationStatus
from unfold.decorators import display
from . import providers
from django.utils.functional import cached_property
# Register your models here.
from unfold.admin import ModelAdmin, TabularInline
from modeltranslation.admin import TabbedTranslationAdmin
from django.utils.translation import gettext_lazy as _
from import_export.admin import ImportExportModelAdmin
from unfold.contrib.import_export.forms import ExportForm, ImportForm
from .forms import TemplateForm
from .tasks import template_messaging_provider_task

class PrefixInline(TabularInline):
    model = Prefix
    extra = 1
    show_change_link = True

# admin.site.register(MessagingProvider, ModelAdmin)


@admin.register(MessagingProvider)
class MessagingProviderAdmin(ModelAdmin):
    list_display = ['name', 'get_from', 'priority',
                    'is_active', 'communication_method']
    readonly_fields = ['communication_method']
    inlines = [PrefixInline]
    
    fieldsets = [
        ('Basic Information', {
            'fields': ['name', 'priority', 'is_active']
        }),
        ('Authentication and configuration', {
            'fields': [
                'api_key', 'auth_token', 'account_sid',
                'client_id', 'client_secret',
                'application_key', 'application_secret', 'consumer_key',
                'service_name', 'from_phone', 'from_email', 'sender_id'
            ]
        })
    ]
    
    # Use compressed_fields for conditional display
    compressed_fields = True
    
    @display(description="Send from")
    def get_from(self, obj):
        return obj.from_phone or obj.from_email or "-"

    @cached_property
    def conditional_fields(self):

        field_set = DefaultDict(list)
        for provider, class_provider in providers.MAIN_CLASSES.items():
            for field in class_provider.required_fields:
                field_set[field].append(provider)

        print({key: "name == " + " || name == ".join(values)
              for key, values in field_set.items()})
        return {key: "name == '" + "' || name == '".join(values) + "'" for key, values in field_set.items()}


@admin.register(Message)
class MessageAdmin(ModelAdmin):
    list_display = ['communication_method', 'recipient_display',
                    'display_status', 'sent_by', 'created_at']
    list_filter = ['communication_method', 'status', 'created_at', 'provider_name']
    search_fields = ['content', 'recipient_phone',
                     'recipient_email', 'sent_by__email', 'celery_task_id']
    readonly_fields = ['sent_at', 'delivered_at', 'read_at', 'failed_at', 'status',
                        'error_message',
                       'external_message_id', 'celery_task_id', 'created_at', 'updated_at', 'provider_name']

    actions = ['resend_failed_messages']

    @display(
        description=_("Status"),
        label={
            MessageStatus.FAILED: "danger",
            MessageStatus.SENT: "info",
            MessageStatus.PENDING: "dark",
            MessageStatus.DELIVERED: "info",
            MessageStatus.READ: "success",
        },
    )
    def display_status(self, instance):
        return instance.status


    @display(description="Fields")
    def recipient_display(self, obj):
        if obj.recipient_phone:
            return obj.recipient_phone
        elif obj.recipient_email:
            return obj.recipient_email
        return "No recipient"

    def resend_failed_messages(self, request, queryset):
        """Resend failed messages via Celery"""
        from .tasks import send_message_via_provider

        for message in queryset.filter(status=MessageStatus.FAILED):
            send_message_via_provider.delay(message.pk)
    resend_failed_messages.short_description = "Resend failed messages"


@admin.register(Template)
class TemplateAdmin(ModelAdmin, TabbedTranslationAdmin, ImportExportModelAdmin):
    list_display = ['name', 'system_name', 'communication_method',
                    'is_active', 'created_at', 'variables']
    list_filter = ['communication_method', 'is_active',
                   'created_at']
    search_fields = ['name', 'system_name', 'description']
    readonly_fields = ['created_at', 'updated_at']
    form = TemplateForm
    import_form_class = ImportForm
    export_form_class = ExportForm
    list_editable = ['is_active']

    fieldsets = [
        ('Basic Information', {
            'fields': ['system_name', 'name', 'description', 'communication_method', 'model', 'is_active']
        }),
        ('Template Content', {
            'fields': ['template_subject', 'template_text'],
            'description': 'Use Jinja2 template syntax. Example: Hello {{ user.name }}!'
        }),
        ('Timestamps', {
            'fields': ['created_at', 'updated_at'],
            'classes': ['collapse']
        })
    ]

    @display(description="Recipient")
    def variables(self, obj):
        return obj.template_variables
    
    def get_form(self, request, obj=None, **kwargs):
        """Customize form to show help text for Jinja2 templates"""
        form = super().get_form(request, obj, **kwargs)
        for field in form.base_fields.keys():
            if field.startswith('template_text'):
                form.base_fields[field].widget.attrs.update({
                    'rows': 10,
                    'placeholder': _('Hello {{ recipient.name }}!\n\nYour consultation is scheduled for {{ appointment.date }}.')
                })
        
            if field.startswith('template_subject'):
                form.base_fields[field].widget.attrs.update({
                    'placeholder': 'Consultation with {{ practitioner.name }}'
                })
        return form


@admin.register(TemplateValidation)
class TemplateValidationAdmin(ModelAdmin):
    list_display = ['template', 'language_code', 'messaging_provider', 'display_status', 'external_template_id', 'created_at', 'validated_at']
    list_filter = ['status', 'language_code', 'messaging_provider', 'template__communication_method', 'created_at', 'validated_at']
    search_fields = ['template__name', 'template__system_name', 'external_template_id', 'messaging_provider__name', 'language_code']
    readonly_fields = ['created_at', 'updated_at', 'validated_at',
                       'validation_response', 'external_template_id']

    fieldsets = [
        ('Template Information', {
            'fields': ['template', 'messaging_provider', 'language_code']
        }),
        ('Validation Details', {
            'fields': ['external_template_id'],
            'description': 'This field is automatically populated when the template is submitted for validation'
        }),
        ('Status', {
            'fields': ['status', 'task_logs']
        }),
        ('Validation Response', {
            'fields': ['validation_response'],
            'classes': ['collapse'],
            'description': 'Raw response data from the messaging provider'
        }),
        ('Timestamps', {
            'fields': ['created_at', 'updated_at', 'validated_at'],
            'classes': ['collapse']
        })
    ]

    actions = ['validate_templates', 'check_validation_status']

    @display(
        description=_("Status"),
        label={
            TemplateValidationStatus.CREATED: "dark",
            TemplateValidationStatus.PENDING: "warning",
            TemplateValidationStatus.VALIDATED: "success",
            TemplateValidationStatus.REJECTED: "danger",
        },
    )
    def display_status(self, instance):
        return instance.get_status_display()

    def get_queryset(self, request):
        """Filter templates based on communication method and provider capabilities"""
        qs = super().get_queryset(request)

        # Only show validations for providers that support template validation
        provider_names = []
        for provider_name, provider_class in providers.MAIN_CLASSES.items():
            # Check if provider has validation methods
            if (hasattr(provider_class, 'validate_template') and
                hasattr(provider_class, 'check_template_validation')):
                provider_names.append(provider_name)

        if provider_names:
            qs = qs.filter(messaging_provider__name__in=provider_names)

        return qs.select_related('template', 'messaging_provider')

    def validate_templates(self, request, queryset):
        """Validate templates with their respective providers"""

        for template_validation in queryset:
            template_messaging_provider_task.delay(
                template_validation.pk, 'validate_template')
    validate_templates.short_description = "Validate selected templates"

    def check_validation_status(self, request, queryset):
        """Check validation status for pending templates"""

        for template_validation in queryset:
            template_messaging_provider_task.delay(
                template_validation.pk, 'check_template_validation')

    check_validation_status.short_description = "Check validation status"
