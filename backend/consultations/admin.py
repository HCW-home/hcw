from django import forms
from django.contrib import admin
from django.forms.models import BaseInlineFormSet
from django.utils.translation import gettext_lazy as _
from modeltranslation.admin import TabbedTranslationAdmin
from unfold.admin import ModelAdmin, StackedInline, TabularInline
from unfold.decorators import display
from typing import DefaultDict
from . import assignments
from django.utils.functional import cached_property

from .models import (
    Appointment,
    BookingSlot,
    Consultation,
    CustomField,
    Message,
    Participant,
    Queue,
    QueueMembership,
    Reason,
    Request,
)


class ReasonCustomFieldInlineFormSet(BaseInlineFormSet):
    def save_new(self, form, commit=True):
        instance = form.save(commit=False)
        instance.target_model = "consultations.Request"
        if commit:
            instance.save()
            form.save_m2m()
        return instance


class ReasonCustomFieldInline(StackedInline):
    model = CustomField
    formset = ReasonCustomFieldInlineFormSet
    extra = 0
    fields = ("name", "field_type", "options", "required", "ordering")
    ordering_field = "ordering"
    hide_ordering_field = True
    verbose_name = "Custom field"
    verbose_name_plural = "Custom fields asked at booking"

admin.site.register(Participant, ModelAdmin)


@admin.register(CustomField)
class CustomFieldAdmin(ModelAdmin, TabbedTranslationAdmin):
    list_display = ["name", "field_type", "target_model", "required", "ordering", "is_public"]
    list_editable = ["is_public"]
    list_filter = ["target_model", "field_type", "required", "is_public"]
    search_fields = ["name"]


class QueueMembershipInlineForm(forms.ModelForm):
    class Meta:
        model = QueueMembership
        fields = ["user", "encrypted_queue_private_key"]
        widgets = {
            "encrypted_queue_private_key": forms.HiddenInput(),
        }


class QueueMembershipInline(TabularInline):
    model = QueueMembership
    form = QueueMembershipInlineForm
    extra = 0
    fields = ["user", "encrypted_queue_private_key", "created_at"]
    readonly_fields = ["created_at"]
    autocomplete_fields = ["user"]
    # The user dropdown filtering to practitioners is enforced via
    # `limit_choices_to` on the QueueMembership.user FK — Django's
    # AutocompleteJsonView calls qs.complex_filter(limit_choices_to) so the
    # restriction applies to the autocomplete results too.

    @property
    def media(self):
        from constance import config as constance_config
        from django.forms import Media

        base = super().media
        if constance_config.encryption_enabled:
            return base + Media(js=("admin/encryption/queue_membership_wrap.js",))
        return base


@admin.register(Queue)
class QueueAdmin(ModelAdmin, TabbedTranslationAdmin):
    list_display = ["name", "users_count", "organisations_count"]
    search_fields = ["name"]
    autocomplete_fields = ["organisation"]
    inlines = [QueueMembershipInline]
    readonly_fields = ["public_key_fingerprint", "encrypted_queue_private_key_master"]
    actions = ["reset_encryption"]

    fieldsets = (
        (None, {"fields": ("name", "organisation")}),
        (
            _("Encryption"),
            {
                "classes": ("collapse",),
                "fields": (
                    "public_key",
                    "public_key_fingerprint",
                    "encrypted_queue_private_key_master",
                ),
            },
        ),
    )

    @display(description="Users")
    def users_count(self, obj):
        return obj.users.count()

    @display(description="Organisations")
    def organisations_count(self, obj):
        return obj.organisation.count()

    @admin.action(description=_("Reset encryption keypair (irreversible)"))
    def reset_encryption(self, request, queryset):
        """Drop the queue keypair + all per-membership wrapped keys, then
        provision a fresh keypair under the current master pubkey
        synchronously (does not require a running Celery worker).

        Use case: the platform master was regenerated after this queue was
        first provisioned, so its `encrypted_queue_private_key_master` is
        wrapped under a stale master pubkey and can no longer be unwrapped.
        Resetting generates a fresh queue keypair under the current master.
        Existing consultations that relied on this queue's pubkey for chat
        access will need their queue envelope rewrapped (or be created
        again).
        """
        from constance import config as constance_config
        from encryption_admin.tasks import _provision_queue_keypair

        if not constance_config.encryption_enabled:
            self.message_user(
                request,
                _("Encryption is disabled platform-wide; nothing to reset."),
                level="warning",
            )
            return
        if not constance_config.master_public_key:
            self.message_user(
                request,
                _("Master public key is not configured."),
                level="error",
            )
            return

        count = 0
        for queue in queryset:
            queue.public_key = None
            queue.public_key_fingerprint = None
            queue.encrypted_queue_private_key_master = None
            queue.save(
                update_fields=[
                    "public_key",
                    "public_key_fingerprint",
                    "encrypted_queue_private_key_master",
                ]
            )
            QueueMembership.objects.filter(queue=queue).update(
                encrypted_queue_private_key=None
            )
            _provision_queue_keypair(queue, constance_config.master_public_key)
            count += 1

        self.message_user(
            request,
            _(
                "Encryption keypair regenerated for %(count)d queue(s) "
                "under the current master."
            ) % {"count": count},
        )


class MessageInline(TabularInline):
    model = Message
    extra = 0
    readonly_fields = ["created_at"]
    fields = ["created_by", "content", "attachment"]


class AppointmentInline(StackedInline):
    model = Appointment
    extra = 0
    fields = ["created_by", "scheduled_at", "end_expected_at", "status"]
    readonly_fields = ["status"]
    show_change_link = True


class ParticipantInline(TabularInline):
    model = Participant
    extra = 0
    fields = [
        "user",
        "is_invited",
    ]


@admin.register(Consultation)
class ConsultationAdmin(ModelAdmin):
    list_display = [
        "id",
        "created_by",
        "beneficiary",
        "group",
        "visible_by_patient",
        "created_at",
        "closed_at",
        "messages_count",
    ]
    list_filter = ["created_at", "closed_at", "group", "visible_by_patient"]
    search_fields = ["created_by__email", "beneficiary__email", "group__name"]
    readonly_fields = ["created_at", "updated_at"]

    autocomplete_fields = [
        "beneficiary",
        "group",
        "owned_by",
    ]

    inlines = [AppointmentInline, MessageInline]

    @display(description="Messages")
    def messages_count(self, obj):
        return obj.messages.count()


@admin.register(Appointment)
class AppointmentAdmin(ModelAdmin):
    list_display = [
        "id",
        "consultation",
        "scheduled_at",
        "end_expected_at",
        "participants_count",
    ]
    list_filter = ["scheduled_at", "consultation__group"]
    search_fields = ["consultation__created_by__email"]

    inlines = [ParticipantInline]

    @display(description="Participants")
    def participants_count(self, obj):
        return obj.participants.count()


@admin.register(Reason)
class ReasonAdmin(ModelAdmin, TabbedTranslationAdmin):
    list_display = [
        "id",
        "name",
        "speciality",
        "duration",
        "is_active",
        "skip_doctor_selection",
        "queue_assignee",
        "user_assignee",
    ]
    list_editable = ["is_active"]
    list_filter = ["is_active", "skip_doctor_selection", "speciality", "queue_assignee"]
    search_fields = ["name", "speciality__name"]
    readonly_fields = ["created_at"]
    autocomplete_fields = ["speciality", "user_assignee", "queue_assignee"]
    inlines = [ReasonCustomFieldInline]

    fieldsets = (
        (None, {"fields": ("name", "speciality", "duration", "is_active")}),
        ("Assignment", {"fields": ("assignment_method", "queue_assignee", "user_assignee", "skip_doctor_selection")}),
    )

    def conditional_fields(self):
        field_set = DefaultDict(list)
        for assignment, class_assignment in assignments.MAIN_CLASSES.items():
            for field in class_assignment.required_fields:
                field_set[field].append(assignment)

        return {
            key: "assignment_method == '" + "' || assignment_method == '".join(values) + "'"
            for key, values in field_set.items()
        }


@admin.register(Message)
class MessageAdmin(ModelAdmin):
    list_display = [
        "id",
        "consultation",
        "created_by",
        "content",
        "attachment",
        "created_at",
    ]


@admin.register(Request)
class RequestAdmin(ModelAdmin):
    list_display = [
        "id",
        "expected_at",
        "consultation",
        "created_by",
        "expected_with",
        "comment",
    ]


@admin.register(BookingSlot)
class BookingSlotAdmin(ModelAdmin):
    list_display = [
        "id",
        "user",
        "start_time",
        "end_time",
        "monday",
        "tuesday",
        "wednesday",
        "thursday",
        "friday",
        "saturday",
        "sunday",
        "valid_until",
    ]
