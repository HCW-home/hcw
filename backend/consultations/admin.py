from django.contrib import admin
from unfold.admin import ModelAdmin, TabularInline
from unfold.decorators import display
from .models import Group, Consultation, Appointment, Participant, Message


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
    readonly_fields = ['created_at']
    fields = ['created_by', 'content', 'attachment']


class AppointmentInline(TabularInline):
    model = Appointment
    extra = 0
    fields = ['created_by', 'scheduled_at', 'end_expected_at']


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

