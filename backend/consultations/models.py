import re
import uuid
from datetime import time
from enum import Enum
from zoneinfo import available_timezones

from django.conf import settings
from django.core.exceptions import ValidationError
from django.db import models
from django.utils.translation import gettext_lazy as _
from django_clamd.validators import validate_file_infection
from messaging.models import CommunicationMethod
from users.models import User

from . import assignments
from .managers import ConsultationManager

# Create your models here.


class Queue(models.Model):
    name = models.CharField(_("name"), max_length=200)
    organisation = models.ManyToManyField(
        "users.Organisation", blank=True, verbose_name=_("organisation")
    )
    users = models.ManyToManyField(
        settings.AUTH_USER_MODEL, verbose_name=_("users"), blank=True
    )

    class Meta:
        verbose_name = _("queue")
        verbose_name_plural = _("queues")

    def __str__(self):
        return f"{self.name}"


class Type(models.TextChoices):
    ONLINE = "Online", _("Online")
    INPERSON = "InPerson", _("In person")


class Consultation(models.Model):
    created_at = models.DateTimeField(_("created at"), auto_now_add=True)
    updated_at = models.DateTimeField(_("updated at"), auto_now=True)
    closed_at = models.DateTimeField(_("closed at"), null=True, blank=True)

    description = models.CharField(_("description"), null=True, blank=True)
    title = models.CharField(_("title"), null=True, blank=True)

    beneficiary = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.PROTECT,
        null=True,
        blank=True,
        verbose_name=_("beneficiary"),
    )

    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="%(class)s_created",
        verbose_name=_("created by"),
    )

    group = models.ForeignKey(
        Queue, on_delete=models.SET_NULL, null=True, blank=True, verbose_name=_("group")
    )

    owned_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="%(class)s_owned",
        verbose_name=_("owned by"),
    )

    objects = ConsultationManager()

    class Meta:
        verbose_name = _("consultation")
        verbose_name_plural = _("consultations")
        ordering = ["-created_at"]
        permissions = [
            ("assignee_view_consultation", _("Can view own assigned consultations")),
            (
                "assignee_change_consultation",
                _("Can change own assigned consultations"),
            ),
            (
                "assignee_delete_consultation",
                _("Can delete own assigned consultations"),
            ),
            ("assignee_close_consultation", _("Can close own assigned consultations")),
        ]

    def __str__(self):
        return f"Consultation #{self.pk}"


class AppointmentStatus(models.TextChoices):
    draft = "draft", _("Draft")
    scheduled = "scheduled", _("Scheduled")
    cancelled = "cancelled", _("Cancelled")


class Appointment(models.Model):
    type = models.CharField(choices=Type.choices, default=Type.ONLINE)
    status = models.CharField(
        _("status"),
        choices=AppointmentStatus.choices,
        default=AppointmentStatus.draft,
    )
    consultation = models.ForeignKey(
        Consultation,
        on_delete=models.CASCADE,
        related_name="appointments",
        null=True,
        blank=True,
        verbose_name=_("consultation"),
    )
    scheduled_at = models.DateTimeField(_("scheduled at"))
    previous_scheduled_at = models.DateTimeField(
        _("scheduled at"), null=True, blank=True
    )
    end_expected_at = models.DateTimeField(_("end expected at"), null=True, blank=True)
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, verbose_name=_("created by")
    )
    created_at = models.DateTimeField(_("created at"), auto_now_add=True)

    class Meta:
        verbose_name = _("appointment")
        verbose_name_plural = _("appointments")
        ordering = ["-scheduled_at"]


class ParticipantStatus(Enum):
    draft = _("Draft")
    invited = _("Invited")
    confirmed = _("Confirmed")
    unavailable = _("Not available")


class Participant(models.Model):
    appointment = models.ForeignKey(
        Appointment, on_delete=models.CASCADE, related_name="participants"
    )
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
    )

    timezone = models.CharField(
        max_length=63,
        choices=[(tz, tz) for tz in sorted(available_timezones())],
        default="UTC",
        help_text="User timezone for displaying dates and times",
    )

    is_invited = models.BooleanField(default=True)
    is_confirmed = models.BooleanField(null=True, blank=True)
    is_notified = models.BooleanField(default=False)

    first_name = models.CharField(null=True, blank=True)
    last_name = models.CharField(null=True, blank=True)
    email = models.EmailField(null=True, blank=True)
    phone = models.CharField(null=True, blank=True)
    communication_method = models.CharField(
        choices=CommunicationMethod.choices, max_length=20
    )
    preferred_language = models.CharField(
        max_length=10,
        choices=settings.LANGUAGES,
        help_text="Preferred language for the user interface",
        null=True,
        blank=True,
    )

    feedback_rate = models.IntegerField(null=True, blank=True)
    feedback_message = models.TextField(null=True, blank=True)

    @property
    def status(self):
        if self.is_confirmed == True:
            return ParticipantStatus.confirmed.value
        if self.is_confirmed == False:
            return ParticipantStatus.unavailable.value
        if self.is_invited:
            return ParticipantStatus.invited.value
        return ParticipantStatus.draft.value

    @property
    def language(self) -> str:
        return self.user.preferred_language or settings.LANGUAGE_CODE

    class Meta:
        unique_together = ["appointment", "user"]

    def save(self, *args, **kwargs):
        # Create temporary user if no user is provided but email/phone exists
        if not self.user and (self.email or self.phone):
            self.user, _ = User.objects.update_or_create(
                email=self.email,
                defaults={
                    "preferred_language": self.preferred_language,
                    "temporary": True,
                    "mobile_phone_number": self.phone,
                    "timezone": self.timezone,
                    "first_name": self.first_name,
                    "last_name": self.last_name,
                },
            )

        if self.appointment.created_by == self.user:
            self.is_notified = True

        super().save(*args, **kwargs)

    @property
    def auth_token(self):
        """Get one_time_auth_token from associated User"""
        return self.user.one_time_auth_token if self.user else None

    @property
    def is_auth_token_used(self):
        """Get is_auth_token_used from associated User"""
        return self.user.is_auth_token_used if self.user else False

    @property
    def name(self) -> str:
        """Get display name of the participant"""
        if self.user.temporary:
            return self.display_name or self.email or self.phone
        return self.user.name or self.user.email

    def clean(self):
        super().clean()
        if not self.user and not self.email and not self.phone:
            raise ValidationError(
                _("At least one of user, email or phone must be provided.")
            )

        if self.phone:
            phone_pattern = r"^(\+\d{1,3}|00\d{1,3})\d{7,14}$"
            if not re.match(
                phone_pattern, self.phone.replace(" ", "").replace("-", "")
            ):
                raise ValidationError(
                    _("Phone number must start with +X or 00X followed by 7-14 digits.")
                )


class Message(models.Model):
    consultation = models.ForeignKey(
        Consultation,
        on_delete=models.CASCADE,
        related_name="messages",
        verbose_name=_("consultation"),
    )
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, verbose_name=_("created by")
    )
    created_at = models.DateTimeField(_("created at"), auto_now_add=True)
    updated_at = models.DateTimeField(_("updated at"), auto_now=True)

    is_edited = models.BooleanField(default=False)
    deleted_at = models.DateTimeField(_("deleted at"), blank=True, null=True)

    event = models.TextField(_("event"), null=True, blank=True)
    content = models.TextField(_("content"), null=True, blank=True)
    attachment = models.FileField(
        _("attachment"),
        upload_to="messages_attachment",
        null=True,
        blank=True,
        validators=[validate_file_infection],
    )

    class Meta:
        verbose_name = _("message")
        verbose_name_plural = _("messages")


class Reason(models.Model):
    speciality = models.ForeignKey(
        "users.Speciality",
        on_delete=models.CASCADE,
        related_name="reasons",
        verbose_name=_("speciality"),
    )
    name = models.CharField(_("name"))
    created_at = models.DateTimeField(_("created at"), auto_now_add=True)
    queue_assignee = models.ForeignKey(
        Queue,
        on_delete=models.CASCADE,
        null=True,
        blank=True,
        verbose_name=_("queue assignee"),
    )
    user_assignee = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        null=True,
        blank=True,
        verbose_name=_("user assignee"),
    )
    duration = models.IntegerField(
        _("duration"), help_text=_("Duration in minutes"), default=30
    )
    is_active = models.BooleanField(_("is active"), default=True)

    assignment_method = models.CharField(choices=assignments.MAIN_DISPLAY_NAMES)

    class Meta:
        verbose_name = _("reason")
        verbose_name_plural = _("reasons")

    def __str__(self):
        return f"{self.name}"

    # def clean(self):
    #     super().clean()

    #     if self.assignment_method == ReasonAssignmentMethod.USER:
    #         if self.queue_assignee:
    #             raise ValidationError(
    #                 _(
    #                     f"Queue must not be defined if assignment method is {ReasonAssignmentMethod.USER}."
    #                 )
    #             )
    #         if not self.user_assignee:
    #             raise ValidationError(
    #                 _(
    #                     f"User must be defined if assignment method is {ReasonAssignmentMethod.USER}."
    #                 )
    #             )

    #     if self.assignment_method == ReasonAssignmentMethod.QUEUE:
    #         if not self.queue_assignee:
    #             raise ValidationError(
    #                 _(
    #                     f"Queue must be defined if assignment method is {ReasonAssignmentMethod.QUEUE}."
    #                 )
    #             )
    #         if self.user_assignee:
    #             raise ValidationError(
    #                 _(
    #                     f"User must not be defined if assignment method is {ReasonAssignmentMethod.QUEUE}."
    #                 )
    #             )

    #     if self.assignment_method == ReasonAssignmentMethod.APPOINTMENT:
    #         if self.user_assignee or self.queue_assignee:
    #             raise ValidationError(
    #                 _(
    #                     f"User or Queue must not be defined if assignment method is {ReasonAssignmentMethod.APPOINTMENT}."
    #                 )
    #             )


class RequestStatus(models.TextChoices):
    requested = "requested", _("Requested")
    accepted = "accepted", _("Accepted")
    cancelled = "cancelled", _("Cancelled")
    refused = "refused", _("Refused")


class Request(models.Model):
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="requests_asrequester",
    )
    expected_at = models.DateTimeField(null=True, blank=True)
    expected_with = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="requests_asexpected",
    )

    beneficiary = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="requests_asbeneficiary",
    )

    type = models.CharField(choices=Type, default=Type.ONLINE)
    reason = models.ForeignKey(
        Reason, on_delete=models.PROTECT, related_name="reasons", null=True, blank=True
    )
    comment = models.TextField(null=True, blank=True)

    refused_reason = models.TextField(null=True, blank=True)
    status = models.CharField(
        choices=RequestStatus.choices, default=RequestStatus.requested
    )

    appointment = models.OneToOneField(
        Appointment, on_delete=models.SET_NULL, null=True, blank=True
    )
    consultation = models.OneToOneField(
        Consultation,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="request",
    )


class BookingSlot(models.Model):
    created_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE)
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="slots"
    )
    start_time = models.TimeField(default=time(8))
    end_time = models.TimeField(default=time(18))

    start_break = models.TimeField(default=time(12), null=True, blank=True)
    end_break = models.TimeField(default=time(14), null=True, blank=True)

    monday = models.BooleanField()
    tuesday = models.BooleanField()
    wednesday = models.BooleanField()
    thursday = models.BooleanField()
    friday = models.BooleanField()
    saturday = models.BooleanField()
    sunday = models.BooleanField()

    valid_until = models.DateField(
        help_text=_("Slot valid until this date"), blank=True, null=True
    )


class PrescriptionStatus(models.TextChoices):
    DRAFT = "Draft", _("Draft")
    PRESCRIBED = "Prescribed", _("Prescribed")
    DISPENSED = "Dispensed", _("Dispensed")
    CANCELLED = "Cancelled", _("Cancelled")


class Prescription(models.Model):
    consultation = models.ForeignKey(
        Consultation,
        on_delete=models.CASCADE,
        related_name="prescriptions",
        verbose_name=_("consultation"),
    )

    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, verbose_name=_("created by")
    )

    created_at = models.DateTimeField(_("created at"), auto_now_add=True)
    updated_at = models.DateTimeField(_("updated at"), auto_now=True)
    prescribed_at = models.DateTimeField(_("prescribed at"), null=True, blank=True)

    status = models.CharField(
        _("status"),
        choices=PrescriptionStatus.choices,
        default=PrescriptionStatus.DRAFT,
        max_length=20,
    )

    medication_name = models.CharField(_("medication name"), max_length=200)
    dosage = models.CharField(_("dosage"), max_length=100)
    frequency = models.CharField(_("frequency"), max_length=100)
    duration = models.CharField(_("duration"), max_length=100, null=True, blank=True)

    instructions = models.TextField(_("instructions"), null=True, blank=True)
    notes = models.TextField(_("notes"), null=True, blank=True)

    class Meta:
        verbose_name = _("prescription")
        verbose_name_plural = _("prescriptions")
        ordering = ["-created_at"]

    def __str__(self):
        return f"Prescription #{self.pk} - {self.medication_name} for {self.patient}"
