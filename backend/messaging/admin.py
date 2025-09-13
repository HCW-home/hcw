from typing import DefaultDict
from django.contrib import admin
from .models import MessagingProvider, Prefix, Message, MessageStatus, Template
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
    readonly_fields = ['sent_at', 'delivered_at', 'read_at', 'failed_at', 'status', 'task_traceback',
                        'error_message', 'task_logs',
                       'external_message_id', 'celery_task_id', 'created_at', 'updated_at', 'provider_name']

    actions = ['resend_failed_messages', 'mark_as_delivered']

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


    @display(description="Recipient")
    def recipient_display(self, obj):
        if obj.recipient_phone:
            return obj.recipient_phone
        elif obj.recipient_email:
            return obj.recipient_email
        return "No recipient"

    def resend_failed_messages(self, request, queryset):
        """Resend failed messages via Celery"""
        from .tasks import send_message_via_provider

        failed_messages = queryset.filter(status=MessageStatus.FAILED)
        queued_count = 0

        for message in failed_messages:
            message.status = MessageStatus.PENDING
            message.error_message = ''
            message.task_traceback = ''
            message.save()

            # Queue for resending
            task = send_message_via_provider.delay(message.id)
            message.celery_task_id = task.id
            message.save()

            queued_count += 1

        self.message_user(
            request,
            f"Queued {queued_count} out of {failed_messages.count()} failed messages for resending."
        )

    resend_failed_messages.short_description = "Resend failed messages"

    def mark_as_delivered(self, request, queryset):
        """Mark selected messages as delivered"""
        sent_messages = queryset.filter(status=MessageStatus.SENT)
        count = 0

        for message in sent_messages:
            message.mark_as_delivered()
            count += 1

        self.message_user(
            request,
            f"Marked {count} messages as delivered."
        )

    mark_as_delivered.short_description = "Mark as delivered"


@admin.register(Template)
class TemplateAdmin(ModelAdmin, TabbedTranslationAdmin, ImportExportModelAdmin):
    list_display = ['name', 'system_name', 'communication_method', 'is_active', 'created_at']
    list_filter = ['communication_method', 'is_active', 'created_at']
    search_fields = ['name', 'system_name', 'description']
    readonly_fields = ['created_at', 'updated_at']
    form = TemplateForm
    import_form_class = ImportForm
    export_form_class = ExportForm
    list_editable = ['is_active']

    fieldsets = [
        ('Basic Information', {
            'fields': ['system_name', 'name', 'description', 'communication_method', 'is_active']
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
