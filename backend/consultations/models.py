from django.db import models
from django.conf import settings
from django.utils.translation import gettext_lazy as _
from messaging.models import CommunicationMethod
from datetime import time

# Create your models here.

class Group(models.Model):
    name = models.CharField(max_length=200)
    organisation = models.ManyToManyField(
        'organisations.Organisation')
    users = models.ManyToManyField(settings.AUTH_USER_MODEL)


class Consultation(models.Model):
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    closed_at = models.DateTimeField(null=True, blank=True)

    description = models.CharField(null=True, blank=True)
    title = models.CharField(null=True, blank=True)

    beneficiary = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.PROTECT,
        null=True,
        blank=True,
    )

    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="%(class)s_created"
    )

    group = models.ForeignKey(Group, on_delete=models.SET_NULL, null=True, blank=True)

    owned_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="%(class)s_owned"
    )

    def __str__(self):
        return f"Consultation #{self.pk}"

class AppointmentStatus(models.TextChoices):
    SCHEDULED = "Scheduled", _("Scheduled")
    CANCELLED = "Cancelled", _("Cancelled")

class Appointment(models.Model):
    status = models.CharField(choices=AppointmentStatus.choices, default=AppointmentStatus.SCHEDULED)
    consultation = models.ForeignKey(
        Consultation, on_delete=models.CASCADE, related_name='appointments')
    scheduled_at = models.DateTimeField()
    end_expected_at = models.DateTimeField(null=True, blank=True)
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE)
    created_at = models.DateTimeField(auto_now_add=True)

class ParticipantRole(models.TextChoices):
    SCHEDULED = "Scheduled", _("Scheduled")
    CANCELLED = "Cancelled", _("Cancelled")

class Participant(models.Model):
    appointement = models.ForeignKey(Appointment, on_delete=models.CASCADE)
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
    )

    # role = 

    auth_token = models.CharField(max_length=256)
    is_invited = models.BooleanField(default=True)

    email = models.EmailField(null=True, blank=True)
    phone = models.CharField(null=True, blank=True)
    message_type = models.CharField(
        choices=CommunicationMethod.choices, max_length=20)

    feedback_rate = models.IntegerField(null=True, blank=True)
    feedback_message = models.TextField(null=True, blank=True)


class Message(models.Model):
    consultation = models.ForeignKey(
        Consultation, on_delete=models.CASCADE, related_name='messages')
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE)
    created_at = models.DateTimeField(auto_now_add=True)

    content = models.TextField(null=True, blank=True)
    attachment = models.FileField(
        upload_to='messages_attachment', null=True, blank=True)


class Reason(models.Model):
    speciality = models.ForeignKey(
        'users.Speciality', on_delete=models.CASCADE, related_name='reasons')
    name = models.CharField()
    created_at = models.DateTimeField(auto_now_add=True)
    group_assignee = models.ForeignKey(Group, on_delete=models.CASCADE, null=True, blank=True)
    user_assignee = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, null=True, blank=True)
    duration = models.IntegerField(help_text="Duration in minute", default=30)
    is_active = models.BooleanField(default=True)

class RequestStatus(models.TextChoices):
    REQUESTED = "Requested", _("Requested")
    ACCEPTED = "Accepted", _("Accepted")
    CANCELLED = "Cancelled", _("Cancelled")

class RequestType(models.TextChoices):
    ONLINE = "Online", _("Online")
    INPERSON = "InPerson", _("In person")

class Request(models.Model):
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name='requests_asrequester')
    expected_at = models.DateTimeField()
    expected_with = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True, related_name='requests_asexpected')
    
    beneficiary = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True, related_name='requests_asbeneficiary')

    type = models.CharField(choices=RequestType, default=RequestType.ONLINE)
    reason = models.ForeignKey(Reason, on_delete=models.PROTECT, related_name='reasons')
    comment = models.TextField()
    status = models.CharField(choices=RequestStatus.choices, default=RequestStatus.REQUESTED)

    appointment = models.OneToOneField(Appointment, on_delete=models.SET_NULL, null=True, blank=True)
    consultation = models.OneToOneField(
        Consultation, on_delete=models.SET_NULL, null=True, blank=True)

class BookingSlot(models.Model):
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE)
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name='slots')
    start_time = models.TimeField(default=time(8))
    end_time = models.TimeField(default=time(18))

    start_break = models.TimeField(default=time(12))
    end_break = models.TimeField(default=time(14))
    
    monday = models.BooleanField()
    tuesday = models.BooleanField()
    wednesday = models.BooleanField()
    thursday = models.BooleanField()
    friday = models.BooleanField()
    saturday = models.BooleanField()
    sunday = models.BooleanField()

    valid_until = models.DateField(help_text="Slot valid until this date", blank=True, null=True)
