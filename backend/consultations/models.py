from django.db import models
from django.conf import settings
from django.utils.translation import gettext_lazy as _
from django.core.exceptions import ValidationError
from messaging.models import CommunicationMethod
from datetime import time
import re

# Create your models here.

class Queue(models.Model):
    name = models.CharField(_('name'), max_length=200)
    organisation = models.ManyToManyField(
        'users.Organisation', blank=True, verbose_name=_('organisation'))
    users = models.ManyToManyField(settings.AUTH_USER_MODEL, verbose_name=_('users'))

    class Meta:
        verbose_name = _('queue')
        verbose_name_plural = _('queues')


class Type(models.TextChoices):
    ONLINE = "Online", _("Online")
    INPERSON = "InPerson", _("In person")

class Consultation(models.Model):
    created_at = models.DateTimeField(_('created at'), auto_now_add=True)
    updated_at = models.DateTimeField(_('updated at'), auto_now=True)
    closed_at = models.DateTimeField(_('closed at'), null=True, blank=True)

    description = models.CharField(_('description'), null=True, blank=True)
    title = models.CharField(_('title'), null=True, blank=True)

    beneficiary = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.PROTECT,
        null=True,
        blank=True,
        verbose_name=_('beneficiary')
    )

    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="%(class)s_created",
        verbose_name=_('created by')
    )

    group = models.ForeignKey(Queue, on_delete=models.SET_NULL, null=True, blank=True, verbose_name=_('group'))

    owned_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="%(class)s_owned",
        verbose_name=_('owned by')
    )

    class Meta:
        verbose_name = _('consultation')
        verbose_name_plural = _('consultations')

    def __str__(self):
        return f"Consultation #{self.pk}"

class AppointmentStatus(models.TextChoices):
    SCHEDULED = "Scheduled", _("Scheduled")
    CANCELLED = "Cancelled", _("Cancelled")

class Appointment(models.Model):

    type = models.CharField(choices=Type.choices, default=Type.ONLINE)
    status = models.CharField(_('status'), choices=AppointmentStatus.choices, default=AppointmentStatus.SCHEDULED)
    consultation = models.ForeignKey(
        Consultation, on_delete=models.CASCADE, related_name='appointments', null=True, blank=True, verbose_name=_('consultation'))
    scheduled_at = models.DateTimeField(_('scheduled at'))
    end_expected_at = models.DateTimeField(_('end expected at'), null=True, blank=True)
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, verbose_name=_('created by'))
    created_at = models.DateTimeField(_('created at'), auto_now_add=True)

    class Meta:
        verbose_name = _('appointment')
        verbose_name_plural = _('appointments')

# class ParticipantRole(models.TextChoices):
#     SCHEDULED = "Scheduled", _("Scheduled")
#     CANCELLED = "Cancelled", _("Cancelled")

class Participant(models.Model):
    appointement = models.ForeignKey(Appointment, on_delete=models.CASCADE)
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
    )


    auth_token = models.CharField(max_length=256)
    is_invited = models.BooleanField(default=True)
    is_confirmed = models.BooleanField(default=False)

    email = models.EmailField(null=True, blank=True)
    phone = models.CharField(null=True, blank=True)
    message_type = models.CharField(
        choices=CommunicationMethod.choices, max_length=20)

    feedback_rate = models.IntegerField(null=True, blank=True)
    feedback_message = models.TextField(null=True, blank=True)

    def clean(self):
        super().clean()
        if not self.user and not self.email and not self.phone:
            raise ValidationError(_('At least one of user, email or phone must be provided.'))
        
        if self.phone:
            phone_pattern = r'^(\+\d{1,3}|00\d{1,3})\d{7,14}$'
            if not re.match(phone_pattern, self.phone.replace(' ', '').replace('-', '')):
                raise ValidationError(_('Phone number must start with +X or 00X followed by 7-14 digits.'))


class Message(models.Model):
    consultation = models.ForeignKey(
        Consultation, on_delete=models.CASCADE, related_name='messages', verbose_name=_('consultation'))
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, verbose_name=_('created by'))
    created_at = models.DateTimeField(_('created at'), auto_now_add=True)

    content = models.TextField(_('content'), null=True, blank=True)
    attachment = models.FileField(
        _('attachment'), upload_to='messages_attachment', null=True, blank=True)

    class Meta:
        verbose_name = _('message')
        verbose_name_plural = _('messages')

class ReasonAssignmentMethod(models.TextChoices):
    USER = 'User', _("User")
    QUEUE = 'Queue', _("Queue")
    APPOINTMENT = 'Appointment', _("Appointment")

class Reason(models.Model):
    speciality = models.ForeignKey(
        'users.Speciality', on_delete=models.CASCADE, related_name='reasons', verbose_name=_('speciality'))
    name = models.CharField(_('name'))
    created_at = models.DateTimeField(_('created at'), auto_now_add=True)
    queue_assignee = models.ForeignKey(Queue, on_delete=models.CASCADE, null=True, blank=True, verbose_name=_('queue assignee'))
    user_assignee = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, null=True, blank=True, verbose_name=_('user assignee'))
    duration = models.IntegerField(_('duration'), help_text=_('Duration in minutes'), default=30)
    is_active = models.BooleanField(_('is active'), default=True)

    assignment_method = models.CharField(choices=ReasonAssignmentMethod.choices, default=ReasonAssignmentMethod.APPOINTMENT)

    class Meta:
        verbose_name = _('reason')
        verbose_name_plural = _('reasons')

    def clean(self):
        super().clean()

        if self.assignment_method == ReasonAssignmentMethod.USER:
            if self.queue_assignee:
                raise ValidationError(
                    _(f'Queue must not be defined if assignment method is {ReasonAssignmentMethod.USER}.'))
            if not self.user_assignee:
                raise ValidationError(
                    _(f'User must be defined if assignment method is {ReasonAssignmentMethod.USER}.'))
            
        if self.assignment_method == ReasonAssignmentMethod.QUEUE:
            if not self.queue_assignee:
                raise ValidationError(
                    _(f'Queue must be defined if assignment method is {ReasonAssignmentMethod.QUEUE}.'))
            if self.user_assignee:
                raise ValidationError(
                    _(f'User must not be defined if assignment method is {ReasonAssignmentMethod.QUEUE}.'))

        if self.assignment_method == ReasonAssignmentMethod.APPOINTMENT:
            if self.user_assignee or self.queue_assignee:
                raise ValidationError(
                    _(f'User or Queue must not be defined if assignment method is {ReasonAssignmentMethod.APPOINTMENT}.'))

class RequestStatus(models.TextChoices):
    REQUESTED = "Requested", _("Requested")
    ACCEPTED = "Accepted", _("Accepted")
    CANCELLED = "Cancelled", _("Cancelled")
    REFUSED = "Refused", _("Refused")

class Request(models.Model):
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name='requests_asrequester')
    expected_at = models.DateTimeField(null=True, blank=True)
    expected_with = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True, related_name='requests_asexpected')
    
    beneficiary = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True, related_name='requests_asbeneficiary')

    type = models.CharField(choices=Type, default=Type.ONLINE)
    reason = models.ForeignKey(Reason, on_delete=models.PROTECT, related_name='reasons', null=True, blank=True)
    comment = models.TextField()

    refused_reason = models.TextField(null=True, blank=True)
    status = models.CharField(choices=RequestStatus.choices, default=RequestStatus.REQUESTED)

    appointment = models.OneToOneField(Appointment, on_delete=models.SET_NULL, null=True, blank=True)
    consultation = models.OneToOneField(
        Consultation, on_delete=models.SET_NULL, null=True, blank=True, related_name="request")

class BookingSlot(models.Model):
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE)
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name='slots')
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

    valid_until = models.DateField(help_text=_("Slot valid until this date"), blank=True, null=True)
