from . import BaseProvider
from typing import TYPE_CHECKING, Tuple, Any
import requests
import hashlib
import time

if TYPE_CHECKING:
    from ..models import Message, MessageStatus, MessagingProvider

class Main(BaseProvider):

    display_name = "Ovh SMS"
    communication_method = "sms"
    required_fields = ['application_key',
                       'consumer_key', 'service_name', 'sender_id']
    
    def _get_signature(self, method, query, body, timestamp):
        application_secret = self.messaging_provider.application_secret or ''
        consumer_key = self.messaging_provider.consumer_key or ''
        
        sha1 = hashlib.sha1()
        sha1.update((application_secret + "+" + consumer_key + "+" + method + "+" + query + "+" + body + "+" + str(timestamp)).encode('utf-8'))
        return "$1$" + sha1.hexdigest()
    
    def send(self, message: 'Message') -> 'MessageStatus':
        from ..models import MessageStatus
        
        try:
            if not message.recipient_phone:
                return MessageStatus.FAILED
            
            application_key = self.messaging_provider.application_key
            consumer_key = self.messaging_provider.consumer_key
            service_name = self.messaging_provider.service_name
            sender = self.messaging_provider.sender_id
            
            if not all([application_key, consumer_key, service_name, sender]):
                return MessageStatus.FAILED
            
            url = f"https://eu.api.ovh.com/1.0/sms/{service_name}/jobs"
            
            body = {
                "message": message.content,
                "receivers": [message.recipient_phone],
                "sender": sender,
                "senderForResponse": True
            }
            
            import json
            body_json = json.dumps(body)
            
            timestamp = int(time.time())
            signature = self._get_signature("POST", url, body_json, timestamp)
            
            headers = {
                'X-Ovh-Application': application_key,
                'X-Ovh-Consumer': consumer_key,
                'X-Ovh-Timestamp': str(timestamp),
                'X-Ovh-Signature': signature,
                'Content-Type': 'application/json'
            }
            
            response = requests.post(url, json=body, headers=headers)
            
            if response.status_code == 200:
                return MessageStatus.SENT
            else:
                return MessageStatus.FAILED
                
        except Exception:
            return MessageStatus.FAILED
    
    def test_connection(self) -> Tuple[bool, Any]:
        try:
            application_key = self.messaging_provider.application_key
            consumer_key = self.messaging_provider.consumer_key
            service_name = self.messaging_provider.service_name
            
            if not all([application_key, consumer_key, service_name]):
                return (False, "Missing application_key, consumer_key or service_name")
            
            url = f"https://eu.api.ovh.com/1.0/sms/{service_name}"
            timestamp = int(time.time())
            signature = self._get_signature("GET", url, "", timestamp)
            
            headers = {
                'X-Ovh-Application': application_key,
                'X-Ovh-Consumer': consumer_key,
                'X-Ovh-Timestamp': str(timestamp),
                'X-Ovh-Signature': signature
            }
            
            response = requests.get(url, headers=headers)
            
            if response.status_code == 200:
                return (True, True)
            else:
                return (False, f"OVH API error: {response.status_code}")
                
        except Exception as e:
            return (False, str(e))

