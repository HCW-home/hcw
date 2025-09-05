from abc import ABC, abstractmethod
from typing import Dict, Any, Optional
from ..models import Message, MessagingProvider
import logging

logger = logging.getLogger(__name__)


class BaseProvider(ABC):
    """
    Abstract base class for messaging providers.
    All messaging providers must implement this interface.
    """
    
    def __init__(self, provider: MessagingProvider):
        """
        Initialize the provider with configuration
        
        Args:
            provider (MessagingProvider): The provider configuration from the database
        """
        self.provider = provider
        self.logger = logging.getLogger(f"{__name__}.{self.__class__.__name__}")
    
    @abstractmethod
    def send_sms(self, message: Message) -> Dict[str, Any]:
        """
        Send SMS message via this provider
        
        Args:
            message (Message): The message to send
            
        Returns:
            Dict[str, Any]: Result dictionary with keys:
                - success (bool): True if sent successfully
                - external_id (str, optional): Provider's message ID
                - error (str, optional): Error message if failed
        """
        pass
    
    def send_whatsapp(self, message: Message) -> Dict[str, Any]:
        """
        Send WhatsApp message via this provider
        Default implementation returns not supported error
        
        Args:
            message (Message): The message to send
            
        Returns:
            Dict[str, Any]: Result dictionary
        """
        return {
            "success": False, 
            "error": f"WhatsApp not supported by {self.__class__.__name__}"
        }
    
    def send_email(self, message: Message) -> Dict[str, Any]:
        """
        Send email message via this provider
        Default implementation returns not supported error
        
        Args:
            message (Message): The message to send
            
        Returns:
            Dict[str, Any]: Result dictionary
        """
        return {
            "success": False, 
            "error": f"Email not supported by {self.__class__.__name__}"
        }
    
    @abstractmethod
    def get_delivery_status(self, external_id: str) -> Dict[str, Any]:
        """
        Get delivery status of a message from the provider
        
        Args:
            external_id (str): The provider's message ID
            
        Returns:
            Dict[str, Any]: Status dictionary with keys:
                - status (str): delivered, failed, pending, etc.
                - timestamp (datetime, optional): Status timestamp
                - error (str, optional): Error message if applicable
        """
        pass
    
    def validate_configuration(self) -> Dict[str, Any]:
        """
        Validate that the provider configuration is correct
        
        Returns:
            Dict[str, Any]: Validation result with keys:
                - valid (bool): True if configuration is valid
                - errors (list): List of configuration errors
        """
        errors = []
        
        if not self.provider.api_key:
            errors.append("API key is required")
        
        return {
            "valid": len(errors) == 0,
            "errors": errors
        }
    
    def test_connection(self) -> Dict[str, Any]:
        """
        Test connection to the provider's API
        Default implementation just validates configuration
        
        Returns:
            Dict[str, Any]: Test result with keys:
                - success (bool): True if connection test passed
                - error (str, optional): Error message if failed
        """
        validation = self.validate_configuration()
        if not validation["valid"]:
            return {
                "success": False,
                "error": f"Configuration errors: {', '.join(validation['errors'])}"
            }
        
        return {"success": True}
    
    def _prepare_phone_number(self, phone: str) -> str:
        """
        Prepare phone number for API call (e.g., add country code, format)
        
        Args:
            phone (str): Raw phone number
            
        Returns:
            str: Formatted phone number
        """
        # Default implementation just returns the phone as-is
        # Override in specific providers for formatting requirements
        return phone.strip()
    
    def _handle_api_error(self, response, message: Message) -> Dict[str, Any]:
        """
        Handle API error response and return standardized error dict
        
        Args:
            response: API response object
            message (Message): The message that was being sent
            
        Returns:
            Dict[str, Any]: Standardized error response
        """
        try:
            error_msg = f"HTTP {response.status_code}"
            if hasattr(response, 'json'):
                error_data = response.json()
                if isinstance(error_data, dict):
                    error_msg = error_data.get('message', error_data.get('error', error_msg))
            
            self.logger.error(
                f"API error sending message {message.id}: {error_msg}",
                extra={'provider': self.provider.name, 'status_code': response.status_code}
            )
            
            return {
                "success": False,
                "error": error_msg
            }
        except Exception as e:
            self.logger.error(f"Error handling API response: {e}")
            return {
                "success": False,
                "error": "Unknown API error"
            }