from typing import Optional, Dict, Any
from django.conf import settings
from messaging.models import MessagingProvider, ProviderName
from .models import Message, CommunicationMethod, MessageStatus
from .providers import ProviderFactory
import logging

logger = logging.getLogger(__name__)


class MessagingService:
    """
    Service to handle message sending via different providers using the new provider architecture
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
        Send SMS message via provider using the new provider architecture
        """
        try:
            logger.info(f"Sending SMS message {message.id} to {message.recipient_phone}")
            
            provider_config = None
            
            # Get provider by name if specified
            if message.provider_name:
                logger.info(f"Using specified provider: {message.provider_name}")
                provider_config = MessagingService.get_provider_by_name(message.provider_name)
                if not provider_config:
                    logger.warning(f"Specified provider '{message.provider_name}' not found or inactive")
            
            # Otherwise, get best provider for phone number
            if not provider_config and message.recipient_phone:
                logger.info(f"Finding best provider for phone number: {message.recipient_phone}")
                provider_config = MessagingService.get_best_provider_for_phone(message.recipient_phone)
                if provider_config:
                    logger.info(f"Selected provider: {provider_config.name} (priority: {provider_config.priority})")
            
            if not provider_config:
                error_msg = "No active messaging provider found"
                logger.error(f"Message {message.id}: {error_msg}")
                message.mark_as_failed(error_msg)
                return {"success": False, "error": error_msg}
            
            # Create provider instance using factory
            provider = ProviderFactory.create_provider(provider_config)
            if not provider:
                error_msg = f"Failed to create provider instance for {provider_config.name}"
                logger.error(f"Message {message.id}: {error_msg}")
                message.mark_as_failed(error_msg)
                return {"success": False, "error": error_msg}
            
            logger.info(f"Sending message {message.id} via {provider_config.name}")
            
            # Send via provider
            result = provider.send_sms(message)
            
            if result.get("success"):
                logger.info(f"Message {message.id} sent successfully via {provider_config.name}. External ID: {result.get('external_id')}")
                message.mark_as_sent(result.get("external_id"))
                return {"success": True, "external_id": result.get("external_id"), "provider": provider_config.name}
            else:
                error_msg = result.get("error", "Unknown error")
                logger.error(f"Message {message.id} failed to send via {provider_config.name}: {error_msg}")
                message.mark_as_failed(f"Provider {provider_config.name}: {error_msg}")
                return {"success": False, "error": error_msg, "provider": provider_config.name}
                
        except Exception as e:
            error_msg = f"Error sending SMS: {str(e)}"
            logger.error(f"Message {message.id}: {error_msg}", exc_info=True)
            message.mark_as_failed(error_msg)
            return {"success": False, "error": error_msg}
    
    @staticmethod
    def send_email(message: Message) -> Dict[str, Any]:
        """
        Send email message using the new provider architecture
        """
        try:
            logger.info(f"Sending email message {message.id} to {message.recipient_email}")
            
            # Get email provider
            provider_config = MessagingService.get_provider_by_name(ProviderName.EMAIL)
            if not provider_config:
                error_msg = "No active email provider found"
                logger.error(f"Message {message.id}: {error_msg}")
                message.mark_as_failed(error_msg)
                return {"success": False, "error": error_msg}
            
            # Create provider instance using factory
            provider = ProviderFactory.create_provider(provider_config)
            if not provider:
                error_msg = f"Failed to create email provider instance"
                logger.error(f"Message {message.id}: {error_msg}")
                message.mark_as_failed(error_msg)
                return {"success": False, "error": error_msg}
            
            logger.info(f"Sending email {message.id} via EmailProvider")
            
            # Send via provider
            result = provider.send_email(message)
            
            if result.get("success"):
                logger.info(f"Email {message.id} sent successfully. External ID: {result.get('external_id')}")
                message.mark_as_sent(result.get("external_id"))
                return {"success": True, "external_id": result.get("external_id"), "provider": "EMAIL"}
            else:
                error_msg = result.get("error", "Unknown error")
                logger.error(f"Email {message.id} failed to send: {error_msg}")
                message.mark_as_failed(f"Email: {error_msg}")
                return {"success": False, "error": error_msg, "provider": "EMAIL"}
            
        except Exception as e:
            error_msg = f"Error sending email: {str(e)}"
            logger.error(f"Message {message.id}: {error_msg}", exc_info=True)
            message.mark_as_failed(error_msg)
            return {"success": False, "error": error_msg}
    
    @staticmethod
    def send_whatsapp(message: Message) -> Dict[str, Any]:
        """
        Send WhatsApp message using the new provider architecture
        """
        try:
            logger.info(f"Sending WhatsApp message {message.id} to {message.recipient_phone}")
            
            # Get WhatsApp provider (Twilio)
            provider_config = MessagingService.get_provider_by_name(ProviderName.TWILIO_WHATSAPP)
            if not provider_config:
                error_msg = "No active WhatsApp provider found"
                logger.error(f"Message {message.id}: {error_msg}")
                message.mark_as_failed(error_msg)
                return {"success": False, "error": error_msg}
            
            # Create provider instance using factory
            provider = ProviderFactory.create_provider(provider_config)
            if not provider:
                error_msg = f"Failed to create WhatsApp provider instance"
                logger.error(f"Message {message.id}: {error_msg}")
                message.mark_as_failed(error_msg)
                return {"success": False, "error": error_msg}
            
            logger.info(f"Sending WhatsApp message {message.id} via Twilio")
            
            # Send via provider
            result = provider.send_whatsapp(message)
            
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
    def send_message(message: Message) -> Dict[str, Any]:
        """
        Main method to send a message based on its communication method
        """
        if message.communication_method == CommunicationMethod.SMS:
            return MessagingService.send_sms(message)
        elif message.communication_method == CommunicationMethod.EMAIL:
            return MessagingService.send_email(message)
        elif message.communication_method == CommunicationMethod.WHATSAPP:
            return MessagingService.send_whatsapp(message)
        else:
            error_msg = f"Unsupported communication method: {message.communication_method}"
            message.mark_as_failed(error_msg)
            return {"success": False, "error": error_msg}
    
    @staticmethod
    def get_delivery_status(message: Message) -> Dict[str, Any]:
        """
        Get delivery status for a message from its provider
        
        Args:
            message (Message): Message to check status for
            
        Returns:
            Dict[str, Any]: Status information
        """
        try:
            if not message.external_message_id:
                return {
                    "status": "unknown",
                    "error": "No external message ID available"
                }
            
            # Determine which provider was used based on message
            provider_config = None
            if message.provider_name:
                provider_config = MessagingService.get_provider_by_name(message.provider_name)
            
            if not provider_config:
                # Try to determine provider from external_message_id format
                external_id = message.external_message_id
                if external_id.startswith("swisscom_"):
                    provider_config = MessagingService.get_provider_by_name(ProviderName.SWISSCOM)
                elif external_id.startswith("ovh_"):
                    provider_config = MessagingService.get_provider_by_name(ProviderName.OVH)
                elif external_id.startswith("twilio_"):
                    provider_config = MessagingService.get_provider_by_name(ProviderName.TWILIO)
                elif external_id.startswith("clickatel_"):
                    provider_config = MessagingService.get_provider_by_name(ProviderName.CLICKATEL)
                elif external_id.startswith("email_"):
                    provider_config = MessagingService.get_provider_by_name(ProviderName.EMAIL)
            
            if not provider_config:
                return {
                    "status": "unknown",
                    "error": "Cannot determine message provider"
                }
            
            # Create provider instance
            provider = ProviderFactory.create_provider(provider_config)
            if not provider:
                return {
                    "status": "unknown",
                    "error": f"Failed to create provider instance for {provider_config.name}"
                }
            
            # Get status from provider
            return provider.get_delivery_status(message.external_message_id)
            
        except Exception as e:
            logger.error(f"Error getting delivery status for message {message.id}: {e}", exc_info=True)
            return {
                "status": "unknown",
                "error": f"Error checking status: {str(e)}"
            }
    
    @staticmethod
    def test_provider_connection(provider_name: str) -> Dict[str, Any]:
        """
        Test connection to a specific provider
        
        Args:
            provider_name (str): Name of provider to test
            
        Returns:
            Dict[str, Any]: Test result
        """
        try:
            provider_config = MessagingService.get_provider_by_name(provider_name)
            if not provider_config:
                return {
                    "success": False,
                    "error": f"Provider {provider_name} not found or inactive"
                }
            
            provider = ProviderFactory.create_provider(provider_config)
            if not provider:
                return {
                    "success": False,
                    "error": f"Failed to create provider instance for {provider_name}"
                }
            
            return provider.test_connection()
            
        except Exception as e:
            logger.error(f"Error testing provider {provider_name}: {e}", exc_info=True)
            return {
                "success": False,
                "error": f"Error testing provider: {str(e)}"
            }