from . import BaseProvider
from typing import TYPE_CHECKING, Tuple, Any, Dict
import requests
import base64
import json

class ProviderException(Exception):
    ...

if TYPE_CHECKING:
    from ..models import Message, MessageStatus, TemplateValidation

class Main(BaseProvider):

    display_name = "Twilio WhatsApp"
    communication_method = "whatsapp"
    required_fields = ['account_sid', 'auth_token', 'from_phone']
    
    def _get_auth_header(self):
        account_sid = self.messaging_provider.account_sid
        auth_token = self.messaging_provider.auth_token
        if not account_sid or not auth_token:
            return None
        credentials = f"{account_sid}:{auth_token}"
        encoded_credentials = base64.b64encode(credentials.encode()).decode()
        return f"Basic {encoded_credentials}"
    
    def send(self, message: 'Message'):

        if not message.recipient_phone:
            raise ProviderException("Missing recipient phone")
        
        auth_header = self._get_auth_header()
        if not auth_header:
            raise ProviderException("No authentication header")
            
        account_sid = self.messaging_provider.account_sid
        
        url = f"https://api.twilio.com/2010-04-01/Accounts/{account_sid}/Messages.json"
        
        data = {
            'From': self.messaging_provider.from_phone,
            'To': message.recipient_phone,
            'Body': message.content
        }
        
        headers = {
            'Authorization': auth_header,
            'Content-Type': 'application/x-www-form-urlencoded'
        }
        
        response = requests.post(url, data=data, headers=headers)

        message.task_logs += response.text

    def test_connection(self) -> Tuple[bool, Any]:
        try:
            auth_header = self._get_auth_header()
            if not auth_header:
                return (False, "Missing account_sid or auth_token")
            
            from_whatsapp = self.messaging_provider.from_phone
            if not from_whatsapp:
                return (False, "Missing from_phone")
            
            account_sid = self.messaging_provider.account_sid
            url = f"https://api.twilio.com/2010-04-01/Accounts/{account_sid}.json"
            
            headers = {'Authorization': auth_header}
            response = requests.get(url, headers=headers)
            
            if response.status_code == 200:
                return (True, True)
            else:
                return (False, f"Twilio API error: {response.status_code}")
                
        except Exception as e:
            return (False, str(e))

    def validate_template(self, template_validation: 'TemplateValidation') -> Tuple[bool, str, Dict[str, Any]]:
        """
        Submit a WhatsApp template for validation with Twilio

        Args:
            template (Template): The template to validate

        Returns:
            Tuple[bool, str, Dict[str, Any]]: (success, external_template_id, response_data)
        """
        try:
            auth_header = self._get_auth_header()
            if not auth_header:
                return (False, "", {"error": "Missing account_sid or auth_token"})

            account_sid = self.messaging_provider.account_sid
            url = f"https://content.twilio.com/v1/Content"

            # Prepare template data for Twilio Content API
            # Note: This is a simplified example - you may need to adjust based on your template structure
            content_data = {
                'friendly_name': template.name,
                'language': 'en',  # You might want to make this configurable
                'variables': {},
                'types': {
                    'twilio/text': {
                        'body': template.template_text
                    }
                }
            }

            # If there's a subject, add it as a header
            if template.template_subject:
                content_data['types']['twilio/text']['header'] = template.template_subject

            headers = {
                'Authorization': auth_header,
                'Content-Type': 'application/json'
            }

            response = requests.post(url, json=content_data, headers=headers)
            response_data = response.json() if response.content else {}

            if response.status_code == 201:
                # Successfully created content template
                external_template_id = response_data.get('sid', '')
                return (True, external_template_id, response_data)
            else:
                return (False, "", response_data)

        except Exception as e:
            return (False, "", {"error": str(e)})

    def check_template_validation(self, template_validation: 'TemplateValidation') -> Tuple[bool, str, Dict[str, Any]]:
        """
        Check the validation status of a WhatsApp template with Twilio

        Args:
            external_template_id (str): The Twilio Content SID

        Returns:
            Tuple[bool, str, Dict[str, Any]]: (is_validated, status, response_data)
        """
        try:
            auth_header = self._get_auth_header()
            if not auth_header:
                return (False, "error", {"error": "Missing account_sid or auth_token"})

            url = f"https://content.twilio.com/v1/Content/{template_validation.external_template_id}"

            headers = {'Authorization': auth_header}
            response = requests.get(url, headers=headers)
            response_data = response.json() if response.content else {}

            if response.status_code == 200:
                # Get the status from the response
                # Twilio Content API returns status in different ways depending on the template state
                status = response_data.get('status', 'unknown').lower()

                # Map Twilio statuses to our understanding
                if status in ['approved', 'active']:
                    return (True, "validated", response_data)
                elif status in ['pending', 'in_review']:
                    return (False, "pending", response_data)
                elif status in ['rejected', 'failed']:
                    return (False, "rejected", response_data)
                else:
                    return (False, status, response_data)
            else:
                return (False, "error", response_data)

        except Exception as e:
            return (False, "error", {"error": str(e)})