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

    # message_service = models.ForeignKey(
    #     'messaging.Service',
    #     on_delete=models.SET_NULL,
    #     null=True,
    #     blank=True,
    # )

class Appointment(models.Model):
    consultation = models.ForeignKey(Consultation, on_delete=models.CASCADE)
    scheduled_at = models.DateTimeField()
    end_expected_at = models.DateTimeField(null=True, blank=True)

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

class MessageStatus(models.TextChoices):
    PENDING = 'pending', 'Pending'
    SENT = 'sent', 'Sent'
    DELIVERED = 'delivered', 'Delivered'
    FAILED = 'failed', 'Failed'
    READ = 'read', 'Read'

class MessageType(models.TextChoices):
    SMS = 'sms', 'SMS'
    EMAIL = 'email', 'Email'
    WHATSAPP = 'whatsapp', 'WhatsApp'
    PUSH = 'push', 'Push Notification'

class Message(models.Model):
    consultation = models.ForeignKey(Consultation, on_delete=models.CASCADE, related_name='messages')
    participant = models.ForeignKey(Participant, on_delete=models.CASCADE, null=True, blank=True)
    
    # Message content
    content = models.TextField()
    subject = models.CharField(max_length=200, blank=True)
    
    # Message type and provider
    message_type = models.CharField(choices=MessageType.choices, max_length=20, default=MessageType.SMS)
    provider_name = models.CharField(max_length=50, blank=True)
    
    # Recipients
    recipient_phone = models.CharField(max_length=50, blank=True)
    recipient_email = models.EmailField(blank=True)
    
    # Status tracking
    status = models.CharField(choices=MessageStatus.choices, max_length=20, default=MessageStatus.PENDING)
    sent_at = models.DateTimeField(null=True, blank=True)
    delivered_at = models.DateTimeField(null=True, blank=True)
    read_at = models.DateTimeField(null=True, blank=True)
    failed_at = models.DateTimeField(null=True, blank=True)
    
    # External provider info
    external_message_id = models.CharField(max_length=200, blank=True)
    error_message = models.TextField(blank=True)
    
    # Celery task tracking
    celery_task_id = models.CharField(max_length=255, blank=True, help_text="Celery task ID for async sending")
    task_logs = models.TextField(blank=True, help_text="Logs from the sending task")
    task_traceback = models.TextField(blank=True, help_text="Error traceback if task failed")
    
    # Sender
    sent_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='sent_messages'
    )
    
    updated_at = models.DateTimeField(auto_now=True)
    created_at = models.DateTimeField(auto_now_add=True)
    
    class Meta:
        ordering = ['-created_at']
    
    def __str__(self):
        return f"Message to {self.recipient_phone or self.recipient_email} - {self.status}"
    
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
