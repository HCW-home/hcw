import traceback
from typing import DefaultDict

from django.conf import settings
from django.contrib import admin, messages
from django.utils.functional import cached_property
from django.utils.translation import gettext_lazy as _
from import_export.admin import ImportExportModelAdmin
from modeltranslation.admin import TabbedTranslationAdmin

# Register your models here.
from unfold.admin import ModelAdmin, TabularInline
from unfold.contrib.import_export.forms import ExportForm, ImportForm
from unfold.decorators import action, display

from . import providers
from .forms import TemplateForm
from .models import (
    CommunicationMethod,
    Message,
    MessageStatus,
    MessagingProvider,
    Template,
    TemplateValidation,
    TemplateValidationStatus,
)
from .template import NOTIFICATION_CHOICES

# admin.site.register(MessagingProvider, ModelAdmin)


@admin.register(MessagingProvider)
class MessagingProviderAdmin(ModelAdmin):
    list_display = ["name", "get_from", "priority", "is_active", "communication_method"]
    readonly_fields = ["communication_method"]

    fieldsets = [
        ("Basic information", {"fields": ["name", "priority", "is_active"]}),
        (
            "Authentication and configuration",
            {
                "fields": [
                    "api_key",
                    "auth_token",
                    "account_sid",
                    "client_id",
                    "client_secret",
                    "application_key",
                    "application_secret",
                    "consumer_key",
                    "service_name",
                    "from_phone",
                    "from_email",
                    "sender_id",
                ]
            },
        ),
        (
            "Phone prefex filtering",
            {
                "fields": ["included_prefixes", "excluded_prefixes"],
                "description": "Configure which phone prefixes this provider should handle. Separate multiple prefixes with commas (e.g. +33, +41, +1). Leave included_prefixes empty to allow all except excluded ones.",
            },
        ),
    ]

    # Use compressed_fields for conditional display
    compressed_fields = True

    actions = ["test_provider"]

    @action(
        description=_("Test connection wiht selected providers"),
    )
    def test_provider(self, request, queryset):
        for provider in queryset.all():
            try:
                provider.instance.test_connection()
                messages.success(request, _(f"Test succesfull: {provider}"))
            except Exception as e:
                messages.error(request, _(f"Test unsuccesfull: {provider}, {e}"))

    @display(description="Send from")
    def get_from(self, obj):
        return obj.from_phone or obj.from_email or "-"

    @cached_property
    def conditional_fields(self):
        field_set = DefaultDict(list)
        for provider, class_provider in providers.MAIN_CLASSES.items():
            for field in class_provider.required_fields:
                field_set[field].append(provider)

        return {
            key: "name == '" + "' || name == '".join(values) + "'"
            for key, values in field_set.items()
        }


@admin.register(Message)
class MessageAdmin(ModelAdmin):
    list_display = [
        "recipient",
        "display_status",
        "sent_by",
        "created_at",
        "display_template_is_valid",
        "error_message",
    ]
    list_filter = ["communication_method", "status", "created_at", "provider_name"]
    search_fields = [
        "content",
        "recipient_phone",
        "recipient_email",
        "sent_by__email",
        "celery_task_id",
    ]
    readonly_fields = [
        "sent_at",
        "delivered_at",
        "read_at",
        "failed_at",
        "status",
        "error_message",
        "external_message_id",
        "celery_task_id",
        "created_at",
        "updated_at",
        "provider_name",
        "display_template_is_valid",
        "display_render_content",
        "display_render_subject",
    ]

    actions = ["send_message"]

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

    @display(
        description=_("Rendering is valid"),
        label={
            "False": "danger",
            "True": "success",
        },
    )
    def display_template_is_valid(self, instance):
        return str(instance.template_is_valid)

    def send_message(self, request, queryset):
        """Resend failed messages via Celery"""

        for message in queryset.all():
            message.send()

    def display_render_content(self, instance):
        try:
            return instance.render_content
        except Exception as e:
            return f"Unable to render the message content: {e}"

    def display_render_subject(self, instance):
        try:
            return instance.render_subject
        except Exception as e:
            return f"Unable to render the message content: {e}"

    send_message.short_description = "Send or resend message"


@admin.register(Template)
class TemplateAdmin(ModelAdmin, TabbedTranslationAdmin, ImportExportModelAdmin):
    list_display = [
        "event_type",
        "communication_method",
        "is_active",
        "created_at",
        "variables",
        "example",
    ]
    list_filter = ["communication_method", "is_active", "created_at"]
    search_fields = ["event_type"]
    readonly_fields = ["created_at", "updated_at"]
    form = TemplateForm
    import_form_class = ImportForm
    export_form_class = ExportForm
    list_editable = ["is_active"]

    # def changelist_view(self, request, extra_context=None):
    #     # Check coverage of notification messages x communication methods
    #     missing_combinations = []
    #     notification_messages = [choice[0] for choice in NOTIFICATION_CHOICES]
    #     communication_methods = [choice[0] for choice in CommunicationMethod.choices]

    #     for event_type in notification_messages:
    #         for comm_method in communication_methods:
    #             # Check if there's a template for this combination
    #             template_exists = Template.objects.filter(
    #                 event_type=event_type, communication_method__contains=[comm_method]
    #             ).exists()

    #             if not template_exists:
    #                 missing_combinations.append(f"{event_type} with {comm_method}")

    #     if missing_combinations:
    #         messages.warning(
    #             request,
    #             _(
    #                 _(
    #                     "Missing template combinations, some message will use native messages: {}"
    #                 )
    #             ).format(
    #                 ", ".join(missing_combinations[:10])
    #                 + (", ..." if len(missing_combinations) > 10 else "")
    #             ),
    #         )
    #     else:
    #         messages.success(
    #             request,
    #             _(
    #                 "All notification message x communication method combinations are configured"
    #             ),
    #         )

    #     return super().changelist_view(request, extra_context=extra_context)

    fieldsets = [
        (
            "Basic Information",
            {"fields": ["event_type", "communication_method", "model", "is_active"]},
        ),
        (
            "Template Content",
            {
                "fields": ["template_subject", "template_content"],
                "description": "Use Jinja2 template syntax. Example: Hello {{ user.name }}!",
            },
        ),
        (
            "Timestamps",
            {"fields": ["created_at", "updated_at"], "classes": ["collapse"]},
        ),
    ]

    @display(description="Render example")
    def example(self, obj):
        try:
            rendered_subject, rendered_text = obj.render_from_template(
                obj=obj.factory_instance.build()
            )
            if rendered_subject:
                return rendered_subject, rendered_text
            return rendered_text
        except Exception:
            print(traceback.format_exc())
            return "-"

    @display(description="Recipient")
    def variables(self, obj):
        return obj.template_variables

    def get_form(self, request, obj=None, **kwargs):
        """Customize form to show help text for Jinja2 templates"""
        form = super().get_form(request, obj, **kwargs)
        for field in form.base_fields.keys():
            if field.startswith("template_content"):
                form.base_fields[field].widget.attrs.update(
                    {
                        "rows": 10,
                        "placeholder": _(
                            "Hello {{ recipient.name }}!\n\nYour consultation is scheduled for {{ appointment.date }}."
                        ),
                    }
                )

            if field.startswith("template_subject"):
                form.base_fields[field].widget.attrs.update(
                    {"placeholder": "Consultation with {{ practitioner.name }}"}
                )
        return form


@admin.register(TemplateValidation)
class TemplateValidationAdmin(ModelAdmin):
    list_display = [
        "template",
        "language_code",
        "messaging_provider",
        "display_status",
        "external_template_id",
        "created_at",
        "validated_at",
    ]
    list_filter = [
        "status",
        "language_code",
        "messaging_provider",
        "template__communication_method",
        "created_at",
        "validated_at",
    ]
    search_fields = [
        "template__system_name",
        "external_template_id",
        "messaging_provider",
        "language_code",
    ]
    readonly_fields = [
        "created_at",
        "updated_at",
        "validated_at",
        "task_logs",
        "status",
        "validation_response",
        "external_template_id",
    ]

    fieldsets = [
        (
            "Template Information",
            {"fields": ["template", "messaging_provider", "language_code"]},
        ),
        (
            "Validation Details",
            {
                "fields": ["external_template_id"],
                "description": "This field is automatically populated when the template is submitted for validation",
            },
        ),
        ("Status", {"fields": ["status", "task_logs"]}),
        (
            "Validation Response",
            {
                "fields": ["validation_response"],
                "classes": ["collapse"],
                "description": "Raw response data from the messaging provider",
            },
        ),
        (
            "Timestamps",
            {
                "fields": ["created_at", "updated_at", "validated_at"],
                "classes": ["collapse"],
            },
        ),
    ]

    actions = ["validate_templates", "check_validation_status"]

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
            if hasattr(provider_class, "validate_template") and hasattr(
                provider_class, "check_template_validation"
            ):
                provider_names.append(provider_name)

        if provider_names:
            qs = qs.filter(messaging_provider__name__in=provider_names)

        return qs.select_related("template", "messaging_provider")

    def check_validation_status(self, request, queryset):
        """Check validation status for pending templates"""

        for template_validation in queryset:
            template_messaging_provider_task.delay(
                template_validation.pk, "check_template_validation"
            )

    check_validation_status.short_description = "Check validation status"
