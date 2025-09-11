from django.contrib import admin
from .models import MessagingProvider, Prefix, Message, MessageStatus
from unfold.decorators import display

# Register your models here.
from unfold.admin import ModelAdmin, TabularInline


class PrefixInline(TabularInline):
    model = Prefix
    extra = 1
    show_change_link = True

# admin.site.register(MessagingProvider, ModelAdmin)


@admin.register(MessagingProvider)
class MessagingProviderAdmin(ModelAdmin):
    list_display = ['name', 'source_phone', 'priority', 'is_active']
    readonly_fields = ['communication_method']
    inlines = [PrefixInline]


@admin.register(Message)
class MessageAdmin(ModelAdmin):
    list_display = ['communication_method', 'recipient_display',
                    'status', 'task_status_display', 'sent_by', 'created_at']
    list_filter = ['communication_method', 'status', 'created_at', 'provider_name']
    search_fields = ['content', 'recipient_phone',
                     'recipient_email', 'sent_by__email', 'celery_task_id']
    readonly_fields = ['sent_at', 'delivered_at', 'read_at', 'failed_at', 'status', 'task_traceback',
                        'error_message', 'task_logs',
                       'external_message_id', 'celery_task_id', 'created_at', 'updated_at', 'provider_name']

    actions = ['resend_failed_messages', 'mark_as_delivered']

    @display(description="Recipient")
    def recipient_display(self, obj):
        if obj.recipient_phone:
            return obj.recipient_phone
        elif obj.recipient_email:
            return obj.recipient_email
        return "No recipient"

    @display(description="Task Status")
    def task_status_display(self, obj):
        if not obj.celery_task_id:
            return "No task"

        try:
            from celery.result import AsyncResult
            result = AsyncResult(obj.celery_task_id)

            if result.state == 'PENDING':
                return "⏳ Pending"
            elif result.state == 'SUCCESS':
                return "✅ Success"
            elif result.state == 'FAILURE':
                return "❌ Failed"
            elif result.state == 'RETRY':
                return "🔄 Retrying"
            else:
                return f"? {result.state}"
        except Exception:
            return "? Unknown"

    def resend_failed_messages(self, request, queryset):
        """Resend failed messages via Celery"""
        from .tasks import send_message_task

        failed_messages = queryset.filter(status=MessageStatus.FAILED)
        queued_count = 0

        for message in failed_messages:
            message.status = MessageStatus.PENDING
            message.error_message = ''
            message.task_traceback = ''
            message.save()

            # Queue for resending
            task = send_message_task.delay(message.id)
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
