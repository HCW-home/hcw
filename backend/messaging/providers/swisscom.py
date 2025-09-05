import requests
from typing import Dict, Any
from .base import BaseProvider
from ..models import Message
import json


class SwisscomProvider(BaseProvider):
    """
    Swisscom SMS provider implementation
    
    API Documentation: https://developer.swisscom.com/
    """
    
    BASE_URL = "https://api.swisscom.com/messaging/sms/v1"
    
    def validate_configuration(self) -> Dict[str, Any]:
        """
        Validate Swisscom-specific configuration
        """
        errors = []
        
        if not self.provider.api_key:
            errors.append("API key is required")
        
        if not self.provider.source_phone:
            errors.append("Source phone number is required")
            
        return {
            "valid": len(errors) == 0,
            "errors": errors
        }
    
    def send_sms(self, message: Message) -> Dict[str, Any]:
        """
        Send SMS via Swisscom API
        
        Args:
            message (Message): Message to send
            
        Returns:
            Dict[str, Any]: Result with success status and external_id or error
        """
        try:
            self.logger.info(f"Sending SMS via Swisscom to {message.recipient_phone}")
            
            # Validate configuration
            validation = self.validate_configuration()
            if not validation["valid"]:
                return {
                    "success": False,
                    "error": f"Configuration error: {', '.join(validation['errors'])}"
                }
            
            # Prepare request data
            payload = {
                "from": self.provider.source_phone,
                "to": self._prepare_phone_number(message.recipient_phone),
                "text": message.content[:160]  # SMS character limit
            }
            
            headers = {
                "Authorization": f"Bearer {self.provider.api_key}",
                "Content-Type": "application/json",
                "Accept": "application/json"
            }
            
            # Make API call
            response = requests.post(
                f"{self.BASE_URL}/messages",
                json=payload,
                headers=headers,
                timeout=30
            )
            
            if response.status_code == 200 or response.status_code == 201:
                try:
                    response_data = response.json()
                    external_id = response_data.get('messageId', f"swisscom_{message.id}")
                    
                    self.logger.info(
                        f"SMS sent successfully via Swisscom. External ID: {external_id}"
                    )
                    
                    return {
                        "success": True,
                        "external_id": external_id
                    }
                    
                except (ValueError, json.JSONDecodeError):
                    # If response is not JSON, assume success with basic ID
                    external_id = f"swisscom_{message.id}"
                    self.logger.info(f"SMS sent via Swisscom (non-JSON response). External ID: {external_id}")
                    return {
                        "success": True,
                        "external_id": external_id
                    }
            else:
                return self._handle_api_error(response, message)
                
        except requests.exceptions.Timeout:
            error_msg = "Request timeout while sending SMS via Swisscom"
            self.logger.error(error_msg)
            return {"success": False, "error": error_msg}
            
        except requests.exceptions.ConnectionError:
            error_msg = "Connection error while sending SMS via Swisscom"
            self.logger.error(error_msg)
            return {"success": False, "error": error_msg}
            
        except Exception as e:
            error_msg = f"Unexpected error sending SMS via Swisscom: {str(e)}"
            self.logger.error(error_msg, exc_info=True)
            return {"success": False, "error": error_msg}
    
    def get_delivery_status(self, external_id: str) -> Dict[str, Any]:
        """
        Get delivery status from Swisscom API
        
        Args:
            external_id (str): Swisscom message ID
            
        Returns:
            Dict[str, Any]: Status information
        """
        try:
            headers = {
                "Authorization": f"Bearer {self.provider.api_key}",
                "Accept": "application/json"
            }
            
            response = requests.get(
                f"{self.BASE_URL}/messages/{external_id}",
                headers=headers,
                timeout=30
            )
            
            if response.status_code == 200:
                try:
                    data = response.json()
                    status_mapping = {
                        'delivered': 'delivered',
                        'failed': 'failed',
                        'pending': 'pending',
                        'sent': 'sent'
                    }
                    
                    swisscom_status = data.get('status', 'unknown')
                    mapped_status = status_mapping.get(swisscom_status, 'unknown')
                    
                    return {
                        "status": mapped_status,
                        "timestamp": data.get('timestamp'),
                        "raw_status": swisscom_status
                    }
                    
                except (ValueError, json.JSONDecodeError):
                    return {
                        "status": "unknown",
                        "error": "Invalid JSON response from Swisscom API"
                    }
            else:
                return {
                    "status": "unknown",
                    "error": f"HTTP {response.status_code} from Swisscom API"
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
        Format phone number for Swisscom API
        
        Args:
            phone (str): Raw phone number
            
        Returns:
            str: Formatted phone number
        """
        # Clean up the phone number
        phone = phone.strip().replace(" ", "").replace("-", "")
        
        # Add Swiss country code if needed
        if phone.startswith("0"):
            phone = "+41" + phone[1:]
        elif not phone.startswith("+"):
            phone = "+" + phone
            
        return phone
    
    def test_connection(self) -> Dict[str, Any]:
        """
        Test connection to Swisscom API
        
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
            
            # Test with a simple account info request or similar endpoint
            # Adjust this based on actual Swisscom API endpoints available
            response = requests.get(
                f"{self.BASE_URL}/account",  # Example endpoint
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