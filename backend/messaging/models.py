from django.db import models
from django.utils.translation import gettext_lazy as _
from django.conf import settings
from typing import Sequence

# Create your models here.
from . import providers

class CommunicationMethod(models.TextChoices):
    SMS = 'sms', ('SMS')
    EMAIL = 'email', ('Email')
    WHATSAPP = 'whatsapp', ('WhatsApp')
    PUSH = 'push', ('Push Notification')
    MANUAL = 'manual', ('Manual')

class MessagingProvider(models.Model):

    @staticmethod
    def provider_name() -> Sequence[tuple[str, str]]:
        return providers.MAIN_DISPLAY_NAMES

    name = models.CharField(_('name'), choices=provider_name(), max_length=20)
    communication_method = models.CharField(choices=CommunicationMethod.choices)
    
    # Common authentication fields
    api_key = models.CharField(_('API key'), max_length=200, blank=True, null=True)
    auth_token = models.CharField(_('auth token'), max_length=200, blank=True, null=True)
    account_sid = models.CharField(_('account SID'), max_length=100, blank=True, null=True)
    
    # OAuth fields
    client_id = models.CharField(_('client ID'), max_length=200, blank=True, null=True)
    client_secret = models.CharField(_('client secret'), max_length=200, blank=True, null=True)
    
    # OVH specific fields
    application_key = models.CharField(_('application key'), max_length=200, blank=True, null=True)
    application_secret = models.CharField(_('application secret'), max_length=200, blank=True, null=True)
    consumer_key = models.CharField(_('consumer key'), max_length=200, blank=True, null=True)
    service_name = models.CharField(_('service name'), max_length=100, blank=True, null=True)
    
    # Sender/From fields
    from_phone = models.CharField(_('from phone'), max_length=50, blank=True, null=True)
    from_email = models.EmailField(_('from email'), blank=True, null=True)
    sender_id = models.CharField(_('sender ID'), max_length=50, blank=True, null=True)
    
    priority = models.IntegerField(_('priority'), default=0)
    is_active = models.BooleanField(_('is active'), default=True)

    def save(self, *args, **kwargs):
        self.communication_method = providers.MAIN_CLASSES.get(
            self.name).communication_method
        
        return super(MessagingProvider, self).save(*args, **kwargs)

    class Meta:
        verbose_name = _('messaging provider')
        verbose_name_plural = _('messaging providers')
        unique_together = ['communication_method', 'priority']

class Prefix(models.Model):
    messaging_provider = models.ForeignKey(MessagingProvider, on_delete=models.CASCADE, null=True, verbose_name=_('messaging provider'))
    start_by = models.CharField(_('start by'), max_length=50)

    class Meta:
        verbose_name = _('prefix')
        verbose_name_plural = _('prefixes')


class MessageStatus(models.TextChoices):
    PENDING = 'pending', 'Pending'
    SENT = 'sent', 'Sent'
    DELIVERED = 'delivered', 'Delivered'
    FAILED = 'failed', 'Failed'
    READ = 'read', 'Read'

class Message(models.Model):
    # Message content
    content = models.TextField(_('content'))
    subject = models.CharField(_('subject'), max_length=200, blank=True)

    # Message type and provider
    communication_method = models.CharField(
        _('communication method'), choices=CommunicationMethod.choices, max_length=20, default=CommunicationMethod.SMS)
    provider_name = models.CharField(_('provider name'), max_length=50, blank=True)

    # Recipients
    recipient_phone = models.CharField(_('recipient phone'), max_length=50, blank=True)
    recipient_email = models.EmailField(_('recipient email'), blank=True)

    # Status tracking
    status = models.CharField(
        _('status'), choices=MessageStatus.choices, max_length=20, default=MessageStatus.PENDING)
    sent_at = models.DateTimeField(null=True, blank=True)
    delivered_at = models.DateTimeField(null=True, blank=True)
    read_at = models.DateTimeField(null=True, blank=True)
    failed_at = models.DateTimeField(null=True, blank=True)

    # External provider info
    external_message_id = models.CharField(max_length=200, blank=True)
    error_message = models.TextField(blank=True)

    # Celery task tracking
    celery_task_id = models.CharField(
        max_length=255, blank=True, help_text="Celery task ID for async sending")
    task_logs = models.TextField(
        blank=True, help_text="Logs from the sending task")
    task_traceback = models.TextField(
        blank=True, help_text="Error traceback if task failed")

    # Sender
    sent_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='sent_messages'
    )

    # Recipient
    sent_to = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='received_messages'
    )

    updated_at = models.DateTimeField(auto_now=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-created_at']

    def __str__(self):
        return f"Message to {self.recipient_phone or self.recipient_email} - {self.status}"
    
    @property
    def preferred_provider(self) -> MessagingProvider:
        """
        Get the preferred messaging provider for this message's communication method
        based on priority (lower number = higher priority) and availability
        
        Returns:
            MessagingProvider: The preferred active provider
            
        Raises:
            MessagingProvider.DoesNotExist: If no active provider supports this communication method
        """
        from . import providers
        
        # Get all active providers and check which ones support this communication method
        all_providers = MessagingProvider.objects.filter(is_active=True).order_by('priority', 'id')
        
        # for provider in all_providers:
        #     try:
        #         # Get the provider class and check its supported communication method
        #         provider_class = get_provider_class(provider.name)
        #         if provider_class:
        #             # Create a temporary instance to check supported method
        #             temp_provider = provider_class(provider)
        #             if temp_provider.supported_communication_method == self.communication_method:
        #                 return provider
        #     except (ImportError, AttributeError):
        #         # Skip providers that can't be loaded
        #         continue
        
        # raise MessagingProvider.DoesNotExist(
        #     f"No active providers available for communication method: {self.communication_method}"
        # )
    
    @property
    def auto_provider_name(self) -> str:
        """
        Get the automatically determined provider name for this message
        
        Returns:
            str: The provider name
        """
        try:
            return self.preferred_provider.name
        except MessagingProvider.DoesNotExist:
            return ""

    def mark_as_sent(self, external_id=None):
        """Mark message as sent"""
        from django.utils import timezone
        self.status = MessageStatus.SENT
        self.sent_at = timezone.now()
        if external_id:
            self.external_message_id = external_id
        self.save()

    def mark_as_delivered(self):
        """Mark message as delivered"""
        from django.utils import timezone
        self.status = MessageStatus.DELIVERED
        self.delivered_at = timezone.now()
        self.save()

    def mark_as_failed(self, error_msg=None):
        """Mark message as failed"""
        from django.utils import timezone
        self.status = MessageStatus.FAILED
        self.failed_at = timezone.now()
        if error_msg:
            self.error_message = error_msg
        self.save()

    def mark_as_read(self):
        """Mark message as read"""
        from django.utils import timezone
        self.status = MessageStatus.READ
        self.read_at = timezone.now()
        self.save()
