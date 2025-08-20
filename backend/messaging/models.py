from django.db import models
from django.utils.translation import gettext_lazy as _

# Create your models here.

class ProviderName(models.TextChoices):
    SWISSCOM = 'Swisscom', 'Swisscom'
    OVH = 'Ovh', 'Ovh'
    CLICKATEL = 'ClickATel', 'ClickATel'
    TWILIO = 'Twilio', 'Twilio'
    TWILIO_WHATSAPP = 'Twilio Whatsapp', 'Twilio Whatsapp'
    EMAIL = 'EMAIL', 'Email'


class MessagingProvider(models.Model):
    name = models.CharField(choices=ProviderName.choices, max_length=20)
    api_key = models.CharField(max_length=200)
    source_phone = models.CharField(max_length=50, null=True, blank=True)
    auth_token = models.CharField(max_length=50, null=True, blank=True)
    account_sid = models.CharField(max_length=50, null=True, blank=True)
    priority = models.IntegerField(default=0)
    is_active = models.BooleanField(default=True)

class Prefix(models.Model):
    messaging_provider = models.ForeignKey(MessagingProvider, on_delete=models.CASCADE, null=True)
    start_by = models.CharField(max_length=50)

    class Meta:
        verbose_name_plural = _("prefixes")
