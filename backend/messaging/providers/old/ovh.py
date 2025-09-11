import requests
from typing import Dict, Any
from .base import BaseProvider
from ..models import Message, CommunicationMethod
import json
import hashlib
import time


class Main(BaseProvider):
    """
    OVH SMS provider implementation
    
    API Documentation: https://docs.ovh.com/gb/en/sms/
    """

    display_name: str = 'OVH SMS'
    
    BASE_URL = "https://eu.api.ovh.com/1.0"
    
    @property
    def supported_communication_method(self) -> CommunicationMethod:
        """
        Return the communication method supported by this provider
        """
        return CommunicationMethod.SMS
    
    def validate_configuration(self) -> Dict[str, Any]:
        """
        Validate OVH-specific configuration
        """
        errors = []
        
        if not self.provider.api_key:
            errors.append("Application Key (api_key) is required")
        
        if not self.provider.auth_token:
            errors.append("Application Secret (auth_token) is required")
        
        if not self.provider.account_sid:
            errors.append("Consumer Key (account_sid) is required")
            
        return {
            "valid": len(errors) == 0,
            "errors": errors
        }
    
    def _generate_signature(self, method: str, url: str, body: str, timestamp: str) -> str:
        """
        Generate OVH API signature
        
        Args:
            method (str): HTTP method
            url (str): Full URL
            body (str): Request body
            timestamp (str): Request timestamp
            
        Returns:
            str: Generated signature
        """
        pre_hash = f"{self.provider.auth_token}+{self.provider.account_sid}+{method}+{url}+{body}+{timestamp}"
        return f"$1${hashlib.sha1(pre_hash.encode()).hexdigest()}"
    
    def send(self, message: Message) -> Dict[str, Any]:
        """
        Send message via OVH API
        
        Args:
            message (Message): Message to send
            
        Returns:
            Dict[str, Any]: Result with success status and external_id or error
        """
        if message.communication_method != CommunicationMethod.SMS:
            return {
                "success": False,
                "error": f"OvhProvider only supports SMS, got {message.communication_method}"
            }
        try:
            self.logger.info(f"Sending SMS via OVH to {message.recipient_phone}")
            
            # Validate configuration
            validation = self.validate_configuration()
            if not validation["valid"]:
                return {
                    "success": False,
                    "error": f"Configuration error: {', '.join(validation['errors'])}"
                }
            
            # Get available SMS services first
            services_result = self._get_sms_services()
            if not services_result["success"]:
                return services_result
            
            service_name = services_result["service_name"]
            
            # Prepare request data
            payload = {
                "message": message.content[:160],  # SMS character limit
                "receivers": [self._prepare_phone_number(message.recipient_phone)],
                "sender": self.provider.source_phone or service_name,
                "senderForResponse": True
            }
            
            # Prepare request
            method = "POST"
            endpoint = f"/sms/{service_name}/jobs"
            url = f"{self.BASE_URL}{endpoint}"
            body = json.dumps(payload)
            timestamp = str(int(time.time()))
            
            headers = {
                "X-Ovh-Application": self.provider.api_key,
                "X-Ovh-Consumer": self.provider.account_sid,
                "X-Ovh-Signature": self._generate_signature(method, url, body, timestamp),
                "X-Ovh-Timestamp": timestamp,
                "Content-Type": "application/json"
            }
            
            # Make API call
            response = requests.post(url, json=payload, headers=headers, timeout=30)
            
            if response.status_code in [200, 201]:
                try:
                    response_data = response.json()
                    job_ids = response_data.get('ids', [])
                    external_id = str(job_ids[0]) if job_ids else f"ovh_{message.id}"
                    
                    self.logger.info(
                        f"SMS sent successfully via OVH. Job ID: {external_id}"
                    )
                    
                    return {
                        "success": True,
                        "external_id": external_id
                    }
                    
                except (ValueError, json.JSONDecodeError, IndexError, KeyError):
                    # If response parsing fails, assume success with basic ID
                    external_id = f"ovh_{message.id}"
                    self.logger.info(f"SMS sent via OVH (response parsing failed). External ID: {external_id}")
                    return {
                        "success": True,
                        "external_id": external_id
                    }
            else:
                return self._handle_api_error(response, message)
                
        except requests.exceptions.Timeout:
            error_msg = "Request timeout while sending SMS via OVH"
            self.logger.error(error_msg)
            return {"success": False, "error": error_msg}
            
        except requests.exceptions.ConnectionError:
            error_msg = "Connection error while sending SMS via OVH"
            self.logger.error(error_msg)
            return {"success": False, "error": error_msg}
            
        except Exception as e:
            error_msg = f"Unexpected error sending SMS via OVH: {str(e)}"
            self.logger.error(error_msg, exc_info=True)
            return {"success": False, "error": error_msg}
    
    def _get_sms_services(self) -> Dict[str, Any]:
        """
        Get available SMS services for the account
        
        Returns:
            Dict[str, Any]: Result with service_name or error
        """
        try:
            method = "GET"
            endpoint = "/sms"
            url = f"{self.BASE_URL}{endpoint}"
            timestamp = str(int(time.time()))
            
            headers = {
                "X-Ovh-Application": self.provider.api_key,
                "X-Ovh-Consumer": self.provider.account_sid,
                "X-Ovh-Signature": self._generate_signature(method, url, "", timestamp),
                "X-Ovh-Timestamp": timestamp
            }
            
            response = requests.get(url, headers=headers, timeout=30)
            
            if response.status_code == 200:
                services = response.json()
                if services and len(services) > 0:
                    return {
                        "success": True,
                        "service_name": services[0]
                    }
                else:
                    return {
                        "success": False,
                        "error": "No SMS services available on OVH account"
                    }
            else:
                return {
                    "success": False,
                    "error": f"Failed to get SMS services: HTTP {response.status_code}"
                }
                
        except Exception as e:
            return {
                "success": False,
                "error": f"Error getting SMS services: {str(e)}"
            }
    
    def get_delivery_status(self, external_id: str) -> Dict[str, Any]:
        """
        Get delivery status from OVH API
        
        Args:
            external_id (str): OVH job ID
            
        Returns:
            Dict[str, Any]: Status information
        """
        try:
            # Get SMS services first
            services_result = self._get_sms_services()
            if not services_result["success"]:
                return {
                    "status": "unknown",
                    "error": services_result["error"]
                }
            
            service_name = services_result["service_name"]
            
            method = "GET"
            endpoint = f"/sms/{service_name}/jobs/{external_id}"
            url = f"{self.BASE_URL}{endpoint}"
            timestamp = str(int(time.time()))
            
            headers = {
                "X-Ovh-Application": self.provider.api_key,
                "X-Ovh-Consumer": self.provider.account_sid,
                "X-Ovh-Signature": self._generate_signature(method, url, "", timestamp),
                "X-Ovh-Timestamp": timestamp
            }
            
            response = requests.get(url, headers=headers, timeout=30)
            
            if response.status_code == 200:
                try:
                    data = response.json()
                    status_mapping = {
                        'delivered': 'delivered',
                        'failed': 'failed',
                        'pending': 'pending',
                        'sent': 'sent',
                        'waiting': 'pending'
                    }
                    
                    ovh_status = data.get('status', 'unknown').lower()
                    mapped_status = status_mapping.get(ovh_status, 'unknown')
                    
                    return {
                        "status": mapped_status,
                        "timestamp": data.get('creationDatetime'),
                        "raw_status": ovh_status
                    }
                    
                except (ValueError, json.JSONDecodeError):
                    return {
                        "status": "unknown",
                        "error": "Invalid JSON response from OVH API"
                    }
            else:
                return {
                    "status": "unknown",
                    "error": f"HTTP {response.status_code} from OVH API"
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
        Format phone number for OVH API
        
        Args:
            phone (str): Raw phone number
            
        Returns:
            str: Formatted phone number
        """
        # Clean up the phone number
        phone = phone.strip().replace(" ", "").replace("-", "")
        
        # OVH expects international format with +
        if not phone.startswith("+"):
            if phone.startswith("0"):
                # Assume Swiss number
                phone = "+41" + phone[1:]
            else:
                phone = "+" + phone
                
        return phone
    
    def test_connection(self) -> Dict[str, Any]:
        """
        Test connection to OVH API
        
        Returns:
            Dict[str, Any]: Connection test result
        """
        validation = self.validate_configuration()
        if not validation["valid"]:
            return {
                "success": False,
                "error": f"Configuration errors: {', '.join(validation['errors'])}"
            }
        
        # Test by getting SMS services
        services_result = self._get_sms_services()
        return services_result