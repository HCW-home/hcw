import requests
from typing import Dict, Any
from .base import BaseProvider
from ..models import Message, CommunicationMethod
import json
import base64


class TwilioWhatsAppProvider(BaseProvider):
    """
    Twilio WhatsApp provider implementation
    
    API Documentation: https://www.twilio.com/docs/whatsapp
    """
    
    BASE_URL = "https://api.twilio.com/2010-04-01"
    
    @property
    def supported_communication_method(self) -> CommunicationMethod:
        """
        Return the communication method supported by this provider
        """
        return CommunicationMethod.WHATSAPP
    
    def validate_configuration(self) -> Dict[str, Any]:
        """
        Validate Twilio-specific configuration
        """
        errors = []
        
        if not self.provider.account_sid:
            errors.append("Account SID is required")
        
        if not self.provider.auth_token:
            errors.append("Auth Token is required")
            
        return {
            "valid": len(errors) == 0,
            "errors": errors
        }
    
    def _get_auth_header(self) -> str:
        """
        Generate Basic Auth header for Twilio API
        
        Returns:
            str: Base64 encoded auth string
        """
        auth_string = f"{self.provider.account_sid}:{self.provider.auth_token}"
        return base64.b64encode(auth_string.encode()).decode()
    
    def send(self, message: Message) -> Dict[str, Any]:
        """
        Send WhatsApp message via Twilio API
        
        Args:
            message (Message): Message to send
            
        Returns:
            Dict[str, Any]: Result with success status and external_id or error
        """
        if message.communication_method != CommunicationMethod.WHATSAPP:
            return {
                "success": False,
                "error": f"TwilioWhatsAppProvider only supports WhatsApp, got {message.communication_method}"
            }
        
        try:
            self.logger.info(f"Sending WhatsApp via Twilio to {message.recipient_phone}")
            
            # Validate configuration
            validation = self.validate_configuration()
            if not validation["valid"]:
                return {
                    "success": False,
                    "error": f"Configuration error: {', '.join(validation['errors'])}"
                }
            
            # Prepare WhatsApp phone numbers (must include whatsapp: prefix)
            from_number = f"whatsapp:{self.provider.source_phone}"
            to_number = f"whatsapp:{self._prepare_phone_number(message.recipient_phone)}"
            
            # Prepare request data
            data = {
                "From": from_number,
                "To": to_number,
                "Body": message.content
            }
            
            headers = {
                "Authorization": f"Basic {self._get_auth_header()}",
                "Content-Type": "application/x-www-form-urlencoded"
            }
            
            # Make API call
            response = requests.post(
                f"{self.BASE_URL}/Accounts/{self.provider.account_sid}/Messages.json",
                data=data,
                headers=headers,
                timeout=30
            )
            
            if response.status_code in [200, 201]:
                try:
                    response_data = response.json()
                    external_id = response_data.get('sid')
                    
                    if not external_id:
                        self.logger.warning("No SID in Twilio WhatsApp response, using fallback ID")
                        external_id = f"twilio_wa_{message.id}"
                    
                    self.logger.info(
                        f"WhatsApp sent successfully via Twilio. SID: {external_id}"
                    )
                    
                    return {
                        "success": True,
                        "external_id": external_id
                    }
                    
                except (ValueError, json.JSONDecodeError):
                    # If response is not JSON, assume success with basic ID
                    external_id = f"twilio_wa_{message.id}"
                    self.logger.info(f"WhatsApp sent via Twilio (non-JSON response). External ID: {external_id}")
                    return {
                        "success": True,
                        "external_id": external_id
                    }
            else:
                return self._handle_api_error(response, message)
                
        except requests.exceptions.Timeout:
            error_msg = "Request timeout while sending WhatsApp via Twilio"
            self.logger.error(error_msg)
            return {"success": False, "error": error_msg}
            
        except requests.exceptions.ConnectionError:
            error_msg = "Connection error while sending WhatsApp via Twilio"
            self.logger.error(error_msg)
            return {"success": False, "error": error_msg}
            
        except Exception as e:
            error_msg = f"Unexpected error sending WhatsApp via Twilio: {str(e)}"
            self.logger.error(error_msg, exc_info=True)
            return {"success": False, "error": error_msg}
    
    def get_delivery_status(self, external_id: str) -> Dict[str, Any]:
        """
        Get delivery status from Twilio API
        
        Args:
            external_id (str): Twilio message SID
            
        Returns:
            Dict[str, Any]: Status information
        """
        try:
            headers = {
                "Authorization": f"Basic {self._get_auth_header()}",
                "Accept": "application/json"
            }
            
            response = requests.get(
                f"{self.BASE_URL}/Accounts/{self.provider.account_sid}/Messages/{external_id}.json",
                headers=headers,
                timeout=30
            )
            
            if response.status_code == 200:
                try:
                    data = response.json()
                    status_mapping = {
                        'delivered': 'delivered',
                        'failed': 'failed', 
                        'undelivered': 'failed',
                        'sent': 'sent',
                        'queued': 'pending',
                        'accepted': 'pending',
                        'read': 'read'
                    }
                    
                    twilio_status = data.get('status', 'unknown').lower()
                    mapped_status = status_mapping.get(twilio_status, 'unknown')
                    
                    return {
                        "status": mapped_status,
                        "timestamp": data.get('date_sent'),
                        "raw_status": twilio_status,
                        "error_code": data.get('error_code'),
                        "error_message": data.get('error_message')
                    }
                    
                except (ValueError, json.JSONDecodeError):
                    return {
                        "status": "unknown",
                        "error": "Invalid JSON response from Twilio API"
                    }
            else:
                return {
                    "status": "unknown",
                    "error": f"HTTP {response.status_code} from Twilio API"
                }
                
        except requests.exceptions.RequestException as e:
            return {
                "status": "unknown",
                "error": f"Request error: {str(e)}"
            }
        except Exception as e:
            return {
                "status": "unknown",
                "error": f"Unexpected error: {str(e)}"
            }
    
    def _prepare_phone_number(self, phone: str) -> str:
        """
        Format phone number for Twilio WhatsApp API
        
        Args:
            phone (str): Raw phone number
            
        Returns:
            str: Formatted phone number
        """
        # Clean up the phone number
        phone = phone.strip().replace(" ", "").replace("-", "")
        
        # Twilio requires E.164 format with +
        if not phone.startswith("+"):
            if phone.startswith("0"):
                # Assume Swiss number
                phone = "+41" + phone[1:]
            else:
                phone = "+" + phone
                
        return phone
    
    def test_connection(self) -> Dict[str, Any]:
        """
        Test connection to Twilio API
        
        Returns:
            Dict[str, Any]: Connection test result
        """
        validation = self.validate_configuration()
        if not validation["valid"]:
            return {
                "success": False,
                "error": f"Configuration errors: {', '.join(validation['errors'])}"
            }
        
        try:
            headers = {
                "Authorization": f"Basic {self._get_auth_header()}",
                "Accept": "application/json"
            }
            
            # Test with account info request
            response = requests.get(
                f"{self.BASE_URL}/Accounts/{self.provider.account_sid}.json",
                headers=headers,
                timeout=10
            )
            
            if response.status_code == 200:
                return {"success": True}
            else:
                return {
                    "success": False,
                    "error": f"API returned status {response.status_code}"
                }
                
        except requests.exceptions.RequestException as e:
            return {
                "success": False,
                "error": f"Connection test failed: {str(e)}"
            }
    
    def _handle_api_error(self, response, message: Message) -> Dict[str, Any]:
        """
        Handle Twilio API error response
        
        Args:
            response: API response object
            message (Message): The message that was being sent
            
        Returns:
            Dict[str, Any]: Standardized error response
        """
        try:
            error_msg = f"HTTP {response.status_code}"
            
            if response.headers.get('content-type', '').startswith('application/json'):
                try:
                    error_data = response.json()
                    if 'message' in error_data:
                        error_msg = error_data['message']
                    elif 'error_message' in error_data:
                        error_msg = error_data['error_message'] 
                    
                    # Include error code if available
                    if 'code' in error_data:
                        error_msg = f"[{error_data['code']}] {error_msg}"
                        
                except (ValueError, json.JSONDecodeError):
                    pass
            
            self.logger.error(
                f"Twilio WhatsApp API error sending message {message.id}: {error_msg}",
                extra={'provider': self.provider.name, 'status_code': response.status_code}
            )
            
            return {
                "success": False,
                "error": error_msg
            }
            
        except Exception as e:
            self.logger.error(f"Error handling Twilio API response: {e}")
            return {
                "success": False,
                "error": "Unknown API error"
            }