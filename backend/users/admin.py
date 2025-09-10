from typing import List, Tuple, Union
from django.db import models
from django.contrib import admin
from .models import User, FCMDeviceOverride, Language, Speciality, HealthMetric, Organisation, Term
from .models import Notification as UserNotification
from django.contrib.auth.admin import GroupAdmin as BaseGroupAdmin
from django.contrib.auth.admin import UserAdmin as BaseUserAdmin
from fcm_django.models import FCMDevice
from fcm_django.admin import DeviceAdmin
from django.contrib import admin, messages
from fcm_django.models import FirebaseResponseDict, fcm_error_list
from django.utils.translation import gettext_lazy as _
from django.utils.translation import ngettext_lazy
from unfold.admin import ModelAdmin, TabularInline, StackedInline
from django.contrib.auth.models import Group
from modeltranslation.admin import TabbedTranslationAdmin
from unfold.contrib.forms.widgets import WysiwygWidget
from unfold.widgets import UnfoldAdminColorInputWidget

from firebase_admin.messaging import (
    ErrorInfo,
    Message,
    Notification,
    SendResponse,
    TopicManagementResponse,
)

admin.site.unregister(Group)

@admin.register(Group)
class GroupAdmin(BaseGroupAdmin, ModelAdmin):
    pass

@admin.register(Term)
class TermAdmin(ModelAdmin):
    formfield_overrides = {
        models.TextField: {
            "widget": WysiwygWidget,
        }
    }

class UserAdmin(BaseUserAdmin, ModelAdmin):
    list_display = [
        "email",
        "first_name",
        "last_name",
        "is_active",
        "is_online",
        "timezone",
        "languages_display",
        "specialities_display",
    ]

    list_filter = BaseUserAdmin.list_filter + \
        ('languages', 'specialities', "is_online")
    filter_horizontal = ('languages', 'specialities')

    fieldsets = BaseUserAdmin.fieldsets + (
        ('Additional Info', {
            'fields': ('app_preferences', 'timezone', 'preferred_language', 'languages', 'specialities', 'main_organisation', 'organisations')
        }),
    )

    def languages_display(self, obj):
        return ", ".join([lang.name for lang in obj.languages.all()[:3]]) + ("..." if obj.languages.count() > 3 else "")
    languages_display.short_description = "Languages"

    def specialities_display(self, obj):
        return ", ".join([spec.name for spec in obj.specialities.all()[:3]]) + ("..." if obj.specialities.count() > 3 else "")
    specialities_display.short_description = "Specialities"

admin.site.register(User, UserAdmin)

admin.site.register(UserNotification, ModelAdmin)

class DeviceAdmin(ModelAdmin):
    list_display = (
        "__str__",
        "device_id",
        "name",
        "type",
        "user",
        "active",
        "date_created",
    )
    list_filter = (
        "active",
        "type",
    )
    actions = (
        "send_message",
        "send_bulk_message",
        "subscribe_to_topic",
        "bulk_subscribe_to_topic",
        "unsubscribe_to_topic",
        "bulk_unsubscribe_to_topic",
        "send_topic_message",
        "enable",
        "disable",
    )
    raw_id_fields = ("user",)
    list_select_related = ("user",)

    def get_search_fields(self, request):
        if hasattr(User, "USERNAME_FIELD"):
            return "name", "device_id", f"user__{User.USERNAME_FIELD}"
        else:
            return "name", "device_id"

    def _send_deactivated_message(
        self,
        request,
        response: Union[
            FirebaseResponseDict,
            List[FirebaseResponseDict],
            List[Tuple[SendResponse, str]],
        ],
        total_failure: int,
        is_topic: bool,
    ):
        if total_failure == 0:
            return
        if is_topic:
            message = ngettext_lazy(
                "A device failed to un/subscribe to topic. %(count)d device was "
                "marked as inactive.",
                "Some devices failed to un/subscribe to topic. %(count)d devices "
                "were marked as inactive.",
                total_failure,
            )
        else:
            message = ngettext_lazy(
                "A message failed to send. %(count)d device was marked as " "inactive.",
                "Some messages failed to send. %(count)d devices were marked as "
                "inactive.",
                total_failure,
            )
        self.message_user(
            request,
            message % {"count": total_failure},
            level=messages.WARNING,
        )

        def _get_to_str_obj(obj):
            if isinstance(obj, SendResponse):
                return obj.exception
            elif isinstance(obj, TopicManagementResponse):
                return obj.errors
            return obj

        def _print_responses(_response):
            __error_list = fcm_error_list + [ErrorInfo]
            # TODO Aggregate error response text. Each firebase error
            #  has multiple response texts too
            [
                self.message_user(
                    request,
                    (
                        _("%(response)s (Registration ID/Tokens: %(reg_id)s)")
                        % {"response": _get_to_str_obj(x), "reg_id": reg_id}
                    ),
                    level=messages.WARNING,
                )
                for x, reg_id in _response
                if type(_get_to_str_obj(x)) in __error_list
            ]

        if isinstance(response, list):
            # Our custom list of single responses
            _print_responses(response)
        elif isinstance(response, FirebaseResponseDict):
            # technically, type should be: FirebaseResponseDict not just dict
            _print_responses(
                zip(
                    response.response.responses,
                    response.deactivated_registration_ids,
                ),
            )
        else:
            raise NotImplementedError

    def send_messages(self, request, queryset, bulk=False):
        """
        Provides error handling for DeviceAdmin send_message and
        send_bulk_message methods.
        """
        total_failure = 0
        single_responses: List[Tuple[SendResponse, str]] = []

        for device in queryset:
            device: "FCMDevice"
            if bulk:
                response = queryset.send_message(
                    Message(
                        notification=Notification(
                            title="Test notification", body="Test bulk notification"
                        )
                    )
                )
                total_failure = len(response.deactivated_registration_ids)
                return self._send_deactivated_message(
                    request, response, total_failure, False
                )
            else:
                response = device.send_message(
                    Message(
                        notification=Notification(
                            title="Test notification", body="Test single notification"
                        )
                    )
                )
                single_responses.append((response, device.registration_id))
                if type(response) != SendResponse:
                    total_failure += 1

        self._send_deactivated_message(
            request, single_responses, total_failure, False)

    def send_message(self, request, queryset):
        self.send_messages(request, queryset)

    send_message.short_description = _("Send test notification")

    def send_bulk_message(self, request, queryset):
        self.send_messages(request, queryset, True)

    send_bulk_message.short_description = _("Send test notification in bulk")

    def handle_topic_subscription(
        self, request, queryset, should_subscribe: bool, bulk: bool = False
    ):
        """
        Provides error handling for DeviceAdmin bulk_un/subscribe_to_topic and
        un/subscribe_to_topic methods.
        """
        total_failure = 0
        single_responses = []

        for device in queryset:
            device: "FCMDevice"
            if bulk:
                response: "FirebaseResponseDict" = queryset.handle_topic_subscription(
                    should_subscribe,
                    "test-topic",
                )
                total_failure = response.response.failure_count
                single_responses = [
                    (x, response.registration_ids_sent[x.index])
                    for x in response.response.errors
                ]
                break
            else:
                response = device.handle_topic_subscription(
                    should_subscribe,
                    "test-topic",
                )
                single_responses.append(
                    (
                        response.response.errors[0]
                        if len(response.response.errors) > 0
                        else "Success",
                        device.registration_id,
                    )
                )
                total_failure += len(response.deactivated_registration_ids)

        self._send_deactivated_message(
            request, single_responses, total_failure, True)

    def subscribe_to_topic(self, request, queryset):
        self.handle_topic_subscription(request, queryset, True)

    subscribe_to_topic.short_description = _("Subscribe to test topic")

    def bulk_subscribe_to_topic(self, request, queryset):
        self.handle_topic_subscription(request, queryset, True, True)

    bulk_subscribe_to_topic.short_description = _(
        "Subscribe to test topic in bulk")

    def unsubscribe_to_topic(self, request, queryset):
        self.handle_topic_subscription(request, queryset, False)

    unsubscribe_to_topic.short_description = _("Unsubscribe to test topic")

    def bulk_unsubscribe_to_topic(self, request, queryset):
        self.handle_topic_subscription(request, queryset, False, True)

    bulk_unsubscribe_to_topic.short_description = _(
        "Unsubscribe to test topic in bulk")

    def handle_send_topic_message(self, request, queryset):
        FCMDevice.send_topic_message(
            Message(
                notification=Notification(
                    title="Test notification", body="Test single notification"
                )
            ),
            "test-topic",
        )

    def send_topic_message(self, request, queryset):
        self.handle_send_topic_message(request, queryset)

    send_topic_message.short_description = _("Send message test topic")

    def enable(self, request, queryset):
        queryset.update(active=True)

    enable.short_description = _("Enable selected devices")

    def disable(self, request, queryset):
        queryset.update(active=False)

    disable.short_description = _("Disable selected devices")


admin.site.unregister(FCMDevice)
admin.site.register(FCMDeviceOverride, DeviceAdmin)

@admin.register(Language)
class LanguageAdmin(ModelAdmin):
    list_display = ['name']
    search_fields = ['name']
    ordering = ['name']

@admin.register(Speciality)
class SpecialityAdmin(ModelAdmin, TabbedTranslationAdmin):
    list_display = ['name']
    search_fields = ['name']
    ordering = ['name']


@admin.register(Organisation)
class OrganisationAdmin(ModelAdmin):
    formfield_overrides = {
        models.TextField: {
            "widget": WysiwygWidget,
        }
    }

    def get_form(self, request, obj=None, change=False, **kwargs):
        print("PASS")
        form = super().get_form(request, obj, change, **kwargs)
        form.base_fields["primary_color"].widget = UnfoldAdminColorInputWidget()
        return form

@admin.register(HealthMetric)
class HealthMetricAdmin(ModelAdmin):
    list_display = [
        'user',
        'measured_at',
        'created_by',
        'systolic_bp',
        'diastolic_bp',
        'heart_rate_bpm',
        'temperature_c',
    ]
    list_filter = [
        'measured_at',
        'created_by',
        'measured_by',
        'source',
    ]
    search_fields = [
        'user__email',
        'user__first_name',
        'user__last_name',
        'notes',
        'source',
    ]
    raw_id_fields = ['user', 'created_by', 'measured_by']
    date_hierarchy = 'measured_at'
    ordering = ['-measured_at']

    fieldsets = (
        ('Basic Information', {
            'fields': (
                'user',
                'measured_at',
                'measured_by',
                'source',
                'notes',
            ),
            'classes': ['tab'],
        }),
        ('Anthropometrics', {
            'fields': (
                'height_cm',
                'weight_kg',
                'waist_cm',
                'hip_cm',
                'body_fat_pct',
            ),
            'classes': ['tab'],
        }),
        ('Vital Signs', {
            'fields': (
                'systolic_bp',
                'diastolic_bp',
                'heart_rate_bpm',
                'respiratory_rate',
                'temperature_c',
                'spo2_pct',
                'pain_score_0_10',
            ),
            'classes': ['tab'],
        }),
        ('Glucose & Diabetes', {
            'fields': (
                'glucose_fasting_mgdl',
                'glucose_random_mgdl',
                'hba1c_pct',
            ),
            'classes': ['tab'],
        }),
        ('Lipid Panel', {
            'fields': (
                'chol_total_mgdl',
                'hdl_mgdl',
                'ldl_mgdl',
                'triglycerides_mgdl',
            ),
            'classes': ['tab'],
        }),
        ('Renal Function', {
            'fields': (
                'creatinine_mgdl',
                'egfr_ml_min_1_73m2',
                'bun_mgdl',
            ),
            'classes': ['tab'],
        }),
        ('Liver Panel', {
            'fields': (
                'alt_u_l',
                'ast_u_l',
                'alp_u_l',
                'bilirubin_total_mgdl',
            ),
            'classes': ['tab'],
        }),
        ('Electrolytes', {
            'fields': (
                'sodium_mmol_l',
                'potassium_mmol_l',
                'chloride_mmol_l',
                'bicarbonate_mmol_l',
            ),
            'classes': ['tab'],
        }),
        ('Hematology', {
            'fields': (
                'hemoglobin_g_dl',
                'wbc_10e9_l',
                'platelets_10e9_l',
                'inr',
            ),
            'classes': ['tab'],
        }),
        ('Inflammation & Thyroid', {
            'fields': (
                'crp_mg_l',
                'esr_mm_h',
                'tsh_miu_l',
                't3_ng_dl',
                't4_ug_dl',
            ),
            'classes': ['tab'],
        }),
        ('Urinalysis', {
            'fields': (
                'urine_protein',
                'urine_glucose',
                'urine_ketones',
            ),
            'classes': ['tab'],
        }),
        ('Respiratory Function', {
            'fields': (
                'peak_flow_l_min',
                'fev1_l',
                'fvc_l',
            ),
            'classes': ['tab'],
        }),
        ('Mental Health', {
            'fields': (
                'phq9_score',
                'gad7_score',
            ),
            'classes': ['tab'],
        }),
        ('Reproductive Health', {
            'fields': (
                'pregnant_test_positive',
            ),
            'classes': ['tab'],
        }),
    )

from django.contrib import admin
from unfold.admin import ModelAdmin
from unfold.widgets import UnfoldAdminSelectWidget, UnfoldAdminTextInputWidget

from django_celery_beat.models import (
    ClockedSchedule,
    CrontabSchedule,
    IntervalSchedule,
    PeriodicTask,
    SolarSchedule,
)
from django_celery_beat.admin import ClockedScheduleAdmin as BaseClockedScheduleAdmin
from django_celery_beat.admin import CrontabScheduleAdmin as BaseCrontabScheduleAdmin
from django_celery_beat.admin import PeriodicTaskAdmin as BasePeriodicTaskAdmin
from django_celery_beat.admin import PeriodicTaskForm, TaskSelectWidget

admin.site.unregister(PeriodicTask)
admin.site.unregister(IntervalSchedule)
admin.site.unregister(CrontabSchedule)
admin.site.unregister(SolarSchedule)
admin.site.unregister(ClockedSchedule)


class UnfoldTaskSelectWidget(UnfoldAdminSelectWidget, TaskSelectWidget):
    pass


class UnfoldPeriodicTaskForm(PeriodicTaskForm):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.fields["task"].widget = UnfoldAdminTextInputWidget()
        self.fields["regtask"].widget = UnfoldTaskSelectWidget()


@admin.register(PeriodicTask)
class PeriodicTaskAdmin(BasePeriodicTaskAdmin, ModelAdmin):
    form = UnfoldPeriodicTaskForm


@admin.register(IntervalSchedule)
class IntervalScheduleAdmin(ModelAdmin):
    pass


@admin.register(CrontabSchedule)
class CrontabScheduleAdmin(BaseCrontabScheduleAdmin, ModelAdmin):
    pass


@admin.register(SolarSchedule)
class SolarScheduleAdmin(ModelAdmin):
    pass

@admin.register(ClockedSchedule)
class ClockedScheduleAdmin(BaseClockedScheduleAdmin, ModelAdmin):
    pass
