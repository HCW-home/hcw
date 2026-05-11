from . import BaseMessagingProvider
from typing import TYPE_CHECKING, Tuple, Any
import requests
import logging

logger = logging.getLogger(__name__)

if TYPE_CHECKING:
    from ..models import Message, MessageStatus, MessagingProvider

class Main(BaseMessagingProvider):

    display_name = "smsmode SMS"
    communication_method = "sms"
    required_fields = ["api_key", "sender_id"]

    def send(self, message: "Message"):
        logger.info(f"Sending SMS via smsmode to {message.phone_number}")

        if not message.phone_number:
            error_msg = "Missing recipient phone number"
            logger.error(error_msg)
            message.task_logs += f"{error_msg}\n"
            message.save()
            raise Exception(error_msg)

        api_key = self.messaging_provider.api_key
        if not api_key:
            error_msg = "Missing smsmode API key"
            logger.error(error_msg)
            message.task_logs += f"{error_msg}\n"
            message.save()
            raise Exception(error_msg)

        # smsmode expects the phone number without leading "+" (e.g. 33600000001)
        normalized_phone = message.phone_number.lstrip("+")

        url = "https://rest.smsmode.com/sms/v1/messages"

        headers = {
            "X-Api-Key": api_key,
            "Content-Type": "application/json",
            "Accept": "application/json",
        }

        data = {
            "recipient": {"to": normalized_phone},
            "body": {"text": message.render_content_sms},
        }

        if self.messaging_provider.sender_id:
            data["sender"] = {"value": self.messaging_provider.sender_id}

        logger.info(f"Sending POST request to smsmode SMS API: {url}")
        response = requests.post(url, json=data, headers=headers)
        logger.info(f"smsmode response status: {response.status_code}")

        message.task_logs += f"smsmode API response: {response.status_code}\n"
        message.task_logs += f"Response body: {response.text}\n"
        message.save()

        if response.status_code in [200, 201, 202]:
            logger.info("SMS sent successfully via smsmode")
            return
        else:
            error_msg = f"smsmode API error: {response.status_code} - {response.text}"
            logger.error(error_msg)
            raise Exception(error_msg)

    def test_connection(self) -> Tuple[bool, Any]:
        try:
            api_key = self.messaging_provider.api_key
            if not api_key:
                return (False, "Missing api_key")

            url = "https://rest.smsmode.com/commons/v1/credit"
            headers = {
                "X-Api-Key": api_key,
                "Accept": "application/json",
            }

            response = requests.get(url, headers=headers)

            if response.status_code == 200:
                return (True, True)
            else:
                return (False, f"smsmode API error: {response.status_code}")

        except Exception as e:
            return (False, str(e))