import requests
from typing import Dict, Any
from .base import BaseProvider
from ..models import Message, CommunicationMethod
import json


class ClickatelProvider(BaseProvider):
    """
    ClickATel SMS provider implementation
    
    API Documentation: https://docs.clickatell.com/
    """
    
    BASE_URL = "https://platform.clickatell.com"
    
    @property
    def supported_communication_method(self) -> CommunicationMethod:
        """
        Return the communication method supported by this provider
        """
        return CommunicationMethod.SMS
    
    def validate_configuration(self) -> Dict[str, Any]:
        """
        Validate ClickATel-specific configuration
        """
        errors = []
        
        if not self.provider.api_key:
            errors.append("API key is required")
            
        return {
            "valid": len(errors) == 0,
            "errors": errors
        }
    
    def send(self, message: Message) -> Dict[str, Any]:
        """
        Send message via ClickATel API
        
        Args:
            message (Message): Message to send
            
        Returns:
            Dict[str, Any]: Result with success status and external_id or error
        """
        if message.communication_method != CommunicationMethod.SMS:
            return {
                "success": False,
                "error": f"ClickatelProvider only supports SMS, got {message.communication_method}"
            }
        try:
            self.logger.info(f"Sending SMS via ClickATel to {message.recipient_phone}")
            
            # Validate configuration
            validation = self.validate_configuration()
            if not validation["valid"]:
                return {
                    "success": False,
                    "error": f"Configuration error: {', '.join(validation['errors'])}"
                }
            
            # Prepare request data
            payload = {
                "messages": [
                    {
                        "to": [self._prepare_phone_number(message.recipient_phone)],
                        "content": message.content[:160]  # SMS character limit
                    }
                ]
            }
            
            # Add sender ID if configured
            if self.provider.source_phone:
                payload["messages"][0]["from"] = self.provider.source_phone
            
            headers = {
                "Authorization": f"Bearer {self.provider.api_key}",
                "Content-Type": "application/json",
                "Accept": "application/json"
            }
            
            # Make API call
            response = requests.post(
                f"{self.BASE_URL}/v1/message",
                json=payload,
                headers=headers,
                timeout=30
            )
            
            if response.status_code in [200, 201, 202]:
                try:
                    response_data = response.json()
                    
                    # ClickATel returns different response formats
                    external_id = None
                    
                    # Check for message array with IDs
                    if 'messages' in response_data and len(response_data['messages']) > 0:
                        message_result = response_data['messages'][0]
                        external_id = message_result.get('apiMessageId') or message_result.get('messageId')
                    
                    # Fallback to direct ID fields
                    if not external_id:
                        external_id = response_data.get('apiMessageId') or response_data.get('messageId')
                    
                    # Use fallback ID if nothing found
                    if not external_id:
                        external_id = f"clickatel_{message.id}"
                    
                    self.logger.info(
                        f"SMS sent successfully via ClickATel. Message ID: {external_id}"
                    )
                    
                    return {
                        "success": True,
                        "external_id": str(external_id)
                    }
                    
                except (ValueError, json.JSONDecodeError, KeyError, IndexError):
                    # If response parsing fails, assume success with basic ID
                    external_id = f"clickatel_{message.id}"
                    self.logger.info(f"SMS sent via ClickATel (response parsing failed). External ID: {external_id}")
                    return {
                        "success": True,
                        "external_id": external_id
                    }
            else:
                return self._handle_api_error(response, message)
                
        except requests.exceptions.Timeout:
            error_msg = "Request timeout while sending SMS via ClickATel"
            self.logger.error(error_msg)
            return {"success": False, "error": error_msg}
            
        except requests.exceptions.ConnectionError:
            error_msg = "Connection error while sending SMS via ClickATel"
            self.logger.error(error_msg)
            return {"success": False, "error": error_msg}
            
        except Exception as e:
            error_msg = f"Unexpected error sending SMS via ClickATel: {str(e)}"
            self.logger.error(error_msg, exc_info=True)
            return {"success": False, "error": error_msg}
    
    def get_delivery_status(self, external_id: str) -> Dict[str, Any]:
        """
        Get delivery status from ClickATel API
        
        Args:
            external_id (str): ClickATel message ID
            
        Returns:
            Dict[str, Any]: Status information
        """
        try:
            headers = {
                "Authorization": f"Bearer {self.provider.api_key}",
                "Accept": "application/json"
            }
            
            response = requests.get(
                f"{self.BASE_URL}/v1/message/{external_id}",
                headers=headers,
                timeout=30
            )
            
            if response.status_code == 200:
                try:
                    data = response.json()
                    
                    # ClickATel status mapping
                    status_mapping = {
                        '001': 'sent',        # Message unknown
                        '002': 'sent',        # Message queued
                        '003': 'delivered',   # Delivered to gateway
                        '004': 'delivered',   # Received by recipient
                        '005': 'failed',      # Error with message
                        '006': 'failed',      # User cancelled message delivery
                        '007': 'failed',      # Error delivering message
                        '008': 'sent',        # OK
                        '009': 'failed',      # Routing error
                        '010': 'failed',      # Message expired
                        '011': 'sent',        # Message queued for later delivery
                        '012': 'failed',      # Out of credit
                        '014': 'failed'       # Maximum MT limit exceeded
                    }
                    
                    clickatel_status = str(data.get('messageStatus', '001'))
                    mapped_status = status_mapping.get(clickatel_status, 'unknown')
                    
                    return {
                        "status": mapped_status,
                        "timestamp": data.get('timestamp'),
                        "raw_status": clickatel_status,
                        "status_description": data.get('statusDescription')
                    }
                    
                except (ValueError, json.JSONDecodeError):
                    return {
                        "status": "unknown",
                        "error": "Invalid JSON response from ClickATel API"
                    }
            else:
                return {
                    "status": "unknown",
                    "error": f"HTTP {response.status_code} from ClickATel API"
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
        Format phone number for ClickATel API
        
        Args:
            phone (str): Raw phone number
            
        Returns:
            str: Formatted phone number
        """
        # Clean up the phone number
        phone = phone.strip().replace(" ", "").replace("-", "")
        
        # ClickATel accepts international format with or without +
        if phone.startswith("0"):
            # Assume Swiss number
            phone = "41" + phone[1:]
        elif phone.startswith("+"):
            phone = phone[1:]  # Remove + as ClickATel doesn't require it
            
        return phone
    
    def test_connection(self) -> Dict[str, Any]:
        """
        Test connection to ClickATel API
        
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
                "Authorization": f"Bearer {self.provider.api_key}",
                "Accept": "application/json"
            }
            
            # Test with account balance or coverage request
            response = requests.get(
                f"{self.BASE_URL}/v1/account/balance",
                headers=headers,
                timeout=10
            )
            
            if response.status_code in [200, 401]:  # 401 means auth failed but API is reachable
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
        Handle ClickATel API error response
        
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
                    
                    # ClickATel error response formats
                    if 'error' in error_data:
                        if isinstance(error_data['error'], dict):
                            error_msg = error_data['error'].get('description', 
                                                             error_data['error'].get('message', error_msg))
                        else:
                            error_msg = str(error_data['error'])
                    elif 'errorDescription' in error_data:
                        error_msg = error_data['errorDescription']
                    elif 'message' in error_data:
                        error_msg = error_data['message']
                    
                    # Include error code if available
                    error_code = error_data.get('errorCode') or error_data.get('code')
                    if error_code:
                        error_msg = f"[{error_code}] {error_msg}"
                        
                except (ValueError, json.JSONDecodeError):
                    pass
            
            self.logger.error(
                f"ClickATel API error sending message {message.id}: {error_msg}",
                extra={'provider': self.provider.name, 'status_code': response.status_code}
            )
            
            return {
                "success": False,
                "error": error_msg
            }
            
        except Exception as e:
            self.logger.error(f"Error handling ClickATel API response: {e}")
            return {
                "success": False,
                "error": "Unknown API error"
            }