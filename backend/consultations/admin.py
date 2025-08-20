from django.contrib import admin
from unfold.admin import ModelAdmin, TabularInline
from unfold.decorators import display
from .models import Group, Consultation, Appointment, Participant, Message, MessageStatus


@admin.register(Group)
class QueueGroupAdmin(ModelAdmin):
    list_display = ['name', 'users_count', 'organisations_count']
    search_fields = ['name']
    filter_horizontal = ['users', 'organisation']
    
    @display(description="Users")
    def users_count(self, obj):
        return obj.users.count()
    
    @display(description="Organisations")
    def organisations_count(self, obj):
        return obj.organisation.count()


class MessageInline(TabularInline):
    model = Message
    extra = 0
    readonly_fields = ['status', 'sent_at', 'delivered_at', 'read_at', 'failed_at', 'external_message_id', 'error_message']
    fields = ['message_type', 'recipient_phone', 'recipient_email', 'content', 'status', 'sent_by']


class AppointmentInline(TabularInline):
    model = Appointment
    extra = 0
    fields = ['scheduled_at', 'end_expected_at']


class ParticipantInline(TabularInline):
    model = Participant
    extra = 0
    fields = ['user', 'is_invited', 'feedback_rate', 'feedback_message']


@admin.register(Consultation)
class ConsultationAdmin(ModelAdmin):
    list_display = ['id', 'created_by', 'beneficiary', 'group', 'created_at', 'closed_at', 'messages_count']
    list_filter = ['created_at', 'closed_at', 'group']
    search_fields = ['created_by__email', 'beneficiary__email', 'group__name']
    readonly_fields = ['created_at', 'updated_at']
    
    fieldsets = (
        (None, {
            'fields': ('created_by', 'owned_by', 'beneficiary', 'group')
        }),
        ('Timestamps', {
            'fields': ('created_at', 'updated_at', 'closed_at'),
            'classes': ('collapse',)
        }),
    )
    
    inlines = [AppointmentInline, MessageInline]
    
    @display(description="Messages")
    def messages_count(self, obj):
        return obj.messages.count()


@admin.register(Appointment)
class AppointmentAdmin(ModelAdmin):
    list_display = ['id', 'consultation', 'scheduled_at', 'end_expected_at', 'participants_count']
    list_filter = ['scheduled_at', 'consultation__group']
    search_fields = ['consultation__created_by__email']
    
    inlines = [ParticipantInline]
    
    @display(description="Participants")
    def participants_count(self, obj):
        return obj.participant_set.count()


@admin.register(Participant)
class ParticipantAdmin(ModelAdmin):
    list_display = ['id', 'user', 'appointement', 'is_invited', 'feedback_rate']
    list_filter = ['is_invited', 'feedback_rate']
    search_fields = ['user__email', 'appointement__consultation__created_by__email']


@admin.register(Message)
class MessageAdmin(ModelAdmin):
    list_display = ['id', 'consultation', 'message_type', 'recipient_display', 'status', 'task_status_display', 'sent_by', 'created_at']
    list_filter = ['message_type', 'status', 'created_at', 'provider_name']
    search_fields = ['content', 'recipient_phone', 'recipient_email', 'sent_by__email', 'celery_task_id']
    readonly_fields = ['sent_at', 'delivered_at', 'read_at', 'failed_at', 'external_message_id', 'celery_task_id', 'created_at', 'updated_at']
    
    fieldsets = (
        ('Message Content', {
            'fields': ('consultation', 'participant', 'content', 'subject', 'message_type')
        }),
        ('Recipients', {
            'fields': ('recipient_phone', 'recipient_email')
        }),
        ('Provider Settings', {
            'fields': ('provider_name',)
        }),
        ('Status & Tracking', {
            'fields': ('status', 'sent_at', 'delivered_at', 'read_at', 'failed_at', 'external_message_id', 'error_message'),
            'classes': ('collapse',)
        }),
        ('Celery Task Info', {
            'fields': ('celery_task_id', 'task_logs', 'task_traceback'),
            'classes': ('collapse',)
        }),
        ('Metadata', {
            'fields': ('sent_by', 'created_at', 'updated_at'),
            'classes': ('collapse',)
        }),
    )
    
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
