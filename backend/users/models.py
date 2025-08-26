import json
from typing import List, Optional
from django.db import models
from django.contrib.auth.models import AbstractUser
from django.forms import ValidationError
from firebase_admin.messaging import Message
from firebase_admin.messaging import Notification as FireBaseNotification
from fcm_django.models import FirebaseResponseDict
from fcm_django.models import AbstractFCMDevice
from .abstracts import ModelOwnerAbstract
from .cryptomanager import CryptoManager
from django.utils import timezone
from . import validators
from channels.layers import get_channel_layer
from asgiref.sync import async_to_sync
from django.utils.translation import gettext_lazy as _

class Language(models.Model):
    name = models.CharField(max_length=100)

class Speciality(models.Model):
    name = models.CharField(max_length=100)

    class Meta:
        verbose_name_plural = _("specialities")

class FCMDeviceOverride(AbstractFCMDevice):
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

class User(AbstractUser):
    app_preferences = models.JSONField(null=True, blank=True)
    encrypted = models.BooleanField(default=False)
    languages = models.ManyToManyField(Language)
    specialities = models.ManyToManyField(Speciality)

    def send_user_notification(self, title, message) -> FirebaseResponseDict:
        # Docs https://fcm-django.readthedocs.io/en/latest/
        """
        Send notification to user over Firebase Cloud Messaging (FCM).

        :param title: notification
        :param message: Notification body
        """

        message = Message(
            notification=FireBaseNotification(title=title, body=message),
        )

        devices = FCMDeviceOverride.objects.filter(user=self)
        return devices.send_message(
            message
        )

class Notification(ModelOwnerAbstract):
    title = models.CharField(max_length=200)
    message = models.TextField()
    acknowledged_at = models.DateTimeField(blank=True, null=True)

    def save(self, *args, **kawrgs):

        if not self.pk:
            firebase_msg = self.user.send_user_notification(
                title=self.title,
                message=self.message,
            )
            super(Notification, self).save(*args, **kawrgs)
            self.send_notification()
        else:
            super(Notification, self).save(*args, **kawrgs)

    def send_notification(self):
        channel_layer = get_channel_layer()
        async_to_sync(channel_layer.group_send)(
            f'user_{self.user.id}',
            {
                "type": "send_notification",
                "data": self.pk
            }
        )
