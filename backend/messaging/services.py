from typing import Optional, Dict, Any
from django.conf import settings
from messaging.models import MessagingProvider, ProviderName
from .models import Message, MessageType, MessageStatus
import logging

logger = logging.getLogger(__name__)

class MessagingService:
    """
    Service to handle message sending via different providers
    """
    
    @staticmethod
    def get_provider_by_name(provider_name: str) -> Optional[MessagingProvider]:
        """Get active messaging provider by name"""
        try:
            return MessagingProvider.objects.filter(
                name=provider_name,
                is_active=True
            ).first()
        except MessagingProvider.DoesNotExist:
            return None
    
    @staticmethod
    def get_best_provider_for_phone(phone_number: str) -> Optional[MessagingProvider]:
        """Get best provider for a phone number based on prefix matching"""
        from messaging.models import Prefix
        
        # Try to find provider by prefix
        for prefix in Prefix.objects.select_related('messaging_provider').all():
            if phone_number.startswith(prefix.start_by):
                if prefix.messaging_provider and prefix.messaging_provider.is_active:
                    return prefix.messaging_provider
        
        # Fallback to highest priority active provider for SMS
        return MessagingProvider.objects.filter(
            is_active=True,
            name__in=[ProviderName.SWISSCOM, ProviderName.OVH, ProviderName.TWILIO]
        ).order_by('-priority').first()
    
    @staticmethod
    def send_sms(message: Message) -> Dict[str, Any]:
        """
        Send SMS message via provider
        This is a placeholder - implement actual provider integration
        """
        try:
            logger.info(f"Sending SMS message {message.id} to {message.recipient_phone}")
            
            provider = None
            
            # Get provider by name if specified
            if message.provider_name:
                logger.info(f"Using specified provider: {message.provider_name}")
                provider = MessagingService.get_provider_by_name(message.provider_name)
                if not provider:
                    logger.warning(f"Specified provider '{message.provider_name}' not found or inactive")
            
            # Otherwise, get best provider for phone number
            if not provider and message.recipient_phone:
                logger.info(f"Finding best provider for phone number: {message.recipient_phone}")
                provider = MessagingService.get_best_provider_for_phone(message.recipient_phone)
                if provider:
                    logger.info(f"Selected provider: {provider.name} (priority: {provider.priority})")
            
            if not provider:
                error_msg = "No active messaging provider found"
                logger.error(f"Message {message.id}: {error_msg}")
                message.mark_as_failed(error_msg)
                return {"success": False, "error": error_msg}
            
            logger.info(f"Sending message {message.id} via {provider.name}")
            
            # PLACEHOLDER: Implement actual provider API calls
            result = MessagingService._send_via_provider(provider, message)
            
            if result.get("success"):
                logger.info(f"Message {message.id} sent successfully via {provider.name}. External ID: {result.get('external_id')}")
                message.mark_as_sent(result.get("external_id"))
                return {"success": True, "external_id": result.get("external_id"), "provider": provider.name}
            else:
                error_msg = result.get("error", "Unknown error")
                logger.error(f"Message {message.id} failed to send via {provider.name}: {error_msg}")
                message.mark_as_failed(f"Provider {provider.name}: {error_msg}")
                return {"success": False, "error": error_msg, "provider": provider.name}
                
        except Exception as e:
            error_msg = f"Error sending SMS: {str(e)}"
            logger.error(f"Message {message.id}: {error_msg}", exc_info=True)
            message.mark_as_failed(error_msg)
            return {"success": False, "error": error_msg}
    
    @staticmethod
    def send_email(message: Message) -> Dict[str, Any]:
        """
        Send email message
        This is a placeholder - implement actual email sending
        """
        try:
            logger.info(f"Sending email message {message.id} to {message.recipient_email}")
            
            # PLACEHOLDER: Implement email sending logic
            # For now, just mark as sent
            external_id = f"email_{message.id}"
            logger.info(f"Email message {message.id} sent successfully. External ID: {external_id}")
            message.mark_as_sent(external_id)
            return {"success": True, "external_id": external_id, "provider": "EMAIL"}
            
        except Exception as e:
            error_msg = f"Error sending email: {str(e)}"
            logger.error(f"Message {message.id}: {error_msg}", exc_info=True)
            message.mark_as_failed(error_msg)
            return {"success": False, "error": error_msg}
    
    @staticmethod
    def send_whatsapp(message: Message) -> Dict[str, Any]:
        """
        Send WhatsApp message via Twilio
        This is a placeholder - implement actual WhatsApp integration
        """
        try:
            logger.info(f"Sending WhatsApp message {message.id} to {message.recipient_phone}")
            
            provider = MessagingService.get_provider_by_name(ProviderName.TWILIO_WHATSAPP)
            
            if not provider:
                error_msg = "No active WhatsApp provider found"
                logger.error(f"Message {message.id}: {error_msg}")
                message.mark_as_failed(error_msg)
                return {"success": False, "error": error_msg}
            
            logger.info(f"Sending WhatsApp message {message.id} via Twilio")
            
            # PLACEHOLDER: Implement WhatsApp API call
            result = MessagingService._send_whatsapp_via_twilio(provider, message)
            
            if result.get("success"):
                logger.info(f"WhatsApp message {message.id} sent successfully. External ID: {result.get('external_id')}")
                message.mark_as_sent(result.get("external_id"))
                return {"success": True, "external_id": result.get("external_id"), "provider": "TWILIO_WHATSAPP"}
            else:
                error_msg = result.get("error", "Unknown error")
                logger.error(f"WhatsApp message {message.id} failed: {error_msg}")
                message.mark_as_failed(f"Twilio WhatsApp: {error_msg}")
                return {"success": False, "error": error_msg, "provider": "TWILIO_WHATSAPP"}
                
        except Exception as e:
            error_msg = f"Error sending WhatsApp: {str(e)}"
            logger.error(f"Message {message.id}: {error_msg}", exc_info=True)
            message.mark_as_failed(error_msg)
            return {"success": False, "error": error_msg}
    
    @staticmethod
    def _send_via_provider(provider: MessagingProvider, message: Message) -> Dict[str, Any]:
        """
        PLACEHOLDER: Send message via specific provider
        Implement actual API calls for each provider
        """
        provider_handlers = {
            ProviderName.SWISSCOM: MessagingService._send_via_swisscom,
            ProviderName.OVH: MessagingService._send_via_ovh,
            ProviderName.TWILIO: MessagingService._send_via_twilio,
            ProviderName.CLICKATEL: MessagingService._send_via_clickatel,
        }
        
        handler = provider_handlers.get(provider.name)
        if handler:
            return handler(provider, message)
        else:
            return {"success": False, "error": f"Provider {provider.name} not implemented"}
    
    @staticmethod
    def _send_via_swisscom(provider: MessagingProvider, message: Message) -> Dict[str, Any]:
        """PLACEHOLDER: Implement Swisscom SMS API"""
        # TODO: Implement actual Swisscom API integration
        logger.info(f"Sending SMS via Swisscom to {message.recipient_phone}")
        return {"success": True, "external_id": f"swisscom_{message.id}"}
    
    @staticmethod
    def _send_via_ovh(provider: MessagingProvider, message: Message) -> Dict[str, Any]:
        """PLACEHOLDER: Implement OVH SMS API"""
        # TODO: Implement actual OVH API integration
        logger.info(f"Sending SMS via OVH to {message.recipient_phone}")
        return {"success": True, "external_id": f"ovh_{message.id}"}
    
    @staticmethod
    def _send_via_twilio(provider: MessagingProvider, message: Message) -> Dict[str, Any]:
        """PLACEHOLDER: Implement Twilio SMS API"""
        # TODO: Implement actual Twilio API integration
        logger.info(f"Sending SMS via Twilio to {message.recipient_phone}")
        return {"success": True, "external_id": f"twilio_{message.id}"}
    
    @staticmethod
    def _send_via_clickatel(provider: MessagingProvider, message: Message) -> Dict[str, Any]:
        """PLACEHOLDER: Implement ClickATel SMS API"""
        # TODO: Implement actual ClickATel API integration
        logger.info(f"Sending SMS via ClickATel to {message.recipient_phone}")
        return {"success": True, "external_id": f"clickatel_{message.id}"}
    
    @staticmethod
    def _send_whatsapp_via_twilio(provider: MessagingProvider, message: Message) -> Dict[str, Any]:
        """PLACEHOLDER: Implement Twilio WhatsApp API"""
        # TODO: Implement actual Twilio WhatsApp API integration
        logger.info(f"Sending WhatsApp via Twilio to {message.recipient_phone}")
        return {"success": True, "external_id": f"twilio_wa_{message.id}"}
    
    @staticmethod
    def send_message(message: Message) -> Dict[str, Any]:
        """
        Main method to send a message based on its type
        """
        if message.message_type == MessageType.SMS:
            return MessagingService.send_sms(message)
        elif message.message_type == MessageType.EMAIL:
            return MessagingService.send_email(message)
        elif message.message_type == MessageType.WHATSAPP:
            return MessagingService.send_whatsapp(message)
        else:
            error_msg = f"Unsupported message type: {message.message_type}"
            message.mark_as_failed(error_msg)
            return {"success": False, "error": error_msg}