from . import BaseProvider
from django.utils.translation import gettext_lazy as _
from django.core.mail import send_mail, get_connection
from django.conf import settings
from typing import TYPE_CHECKING, Tuple, Any

if TYPE_CHECKING:
    from ..models import Message, MessageStatus, MessagingProvider

class Main(BaseProvider):

    display_name = _("Email over Django SMTP")
    communication_method = "email"
    required_fields = ['from_email']

    def send(self, message: 'Message') -> 'MessageStatus':
        from ..models import MessageStatus
        
        try:
            if not message.recipient_email:
                return MessageStatus.FAILED
            
            from_email = self.messaging_provider.from_email or settings.DEFAULT_FROM_EMAIL
            subject = message.subject or "Message from HCW"
            
            send_mail(
                subject=subject,
                message=message.content,
                from_email=from_email,
                recipient_list=[message.recipient_email],
                fail_silently=False
            )
            
            return MessageStatus.DELIVERED
            
        except Exception:
            return MessageStatus.FAILED
    
    def test_connection(self) -> Tuple[bool, Any]:
        try:
            if not hasattr(settings, 'EMAIL_HOST') or not settings.EMAIL_HOST:
                return (False, "EMAIL_HOST setting is required")
            
            from_email = self.messaging_provider.from_email or getattr(settings, 'DEFAULT_FROM_EMAIL', None)
            if not from_email:
                return (False, "from_email is required")
            
            connection = get_connection()
            connection.open()
            connection.close()
            
            return (True, True)
            
        except Exception as e:
            return (False, str(e))
