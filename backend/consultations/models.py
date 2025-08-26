from django.db import models
from django.conf import settings

# Create your models here.

class Group(models.Model):
    name = models.CharField(max_length=200)
    organisation = models.ManyToManyField(
        'organisations.Organisation')
    users = models.ManyToManyField('users.User')


class Consultation(models.Model):
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    closed_at = models.DateTimeField(null=True, blank=True)

    beneficiary = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.PROTECT,
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

class Appointment(models.Model):
    consultation = models.ForeignKey(
        Consultation, on_delete=models.CASCADE, related_name='appointments')
    scheduled_at = models.DateTimeField()
    end_expected_at = models.DateTimeField(null=True, blank=True)
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE)
    created_at = models.DateTimeField(auto_now_add=True)

class Participant(models.Model):
    appointement = models.ForeignKey(Appointment, on_delete=models.CASCADE)
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
    )

    token = models.CharField(max_length=256)
    is_invited = models.BooleanField(default=True)
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


class ReasonForConsultation:
    speciality = models.ForeignKey('users.Specialities', on_delete=models.CASCADE)
    name = models.CharField()
    created_at = models.DateTimeField(auto_now_add=True)
    group_assignee = models.ForeignKey(Group, on_delete=models.CASCADE, null=True, blank=True)
    user_assignee = models.ForeignKey(
        'users.User', on_delete=models.CASCADE, null=True, blank=True)
    duration = models.IntegerField(help_text="Duration in minute", default=30)

