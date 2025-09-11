from . import BaseProvider
from typing import TYPE_CHECKING, Tuple, Any
import requests
import base64

if TYPE_CHECKING:
    from ..models import Message, MessageStatus, MessagingProvider

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
    
    def send(self, message: 'Message') -> 'MessageStatus':
        from ..models import MessageStatus
        
        try:
            if not message.recipient_phone:
                return MessageStatus.FAILED
            
            auth_header = self._get_auth_header()
            if not auth_header:
                return MessageStatus.FAILED
                
            account_sid = self.messaging_provider.account_sid
            from_whatsapp = self.messaging_provider.from_phone
            if not from_whatsapp:
                return MessageStatus.FAILED
            
            url = f"https://api.twilio.com/2010-04-01/Accounts/{account_sid}/Messages.json"
            
            # Format phone numbers for WhatsApp (must include whatsapp: prefix)
            to_whatsapp = f"whatsapp:{message.recipient_phone}"
            if not from_whatsapp.startswith('whatsapp:'):
                from_whatsapp = f"whatsapp:{from_whatsapp}"
            
            data = {
                'From': from_whatsapp,
                'To': to_whatsapp,
                'Body': message.content
            }
            
            headers = {
                'Authorization': auth_header,
                'Content-Type': 'application/x-www-form-urlencoded'
            }
            
            response = requests.post(url, data=data, headers=headers)
            
            if response.status_code == 201:
                return MessageStatus.SENT
            else:
                return MessageStatus.FAILED
                
        except Exception:
            return MessageStatus.FAILED
    
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