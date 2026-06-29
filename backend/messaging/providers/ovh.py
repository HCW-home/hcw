import hashlib
import json
import logging
import time
from typing import TYPE_CHECKING

import requests
from django.utils.translation import gettext_lazy as _

from . import BaseMessagingProvider

logger = logging.getLogger(__name__)

if TYPE_CHECKING:
    from ..models import Message


class Main(BaseMessagingProvider):

    display_name = _("OVH SMS")
    communication_method = "sms"
    required_fields = [
        "application_key",
        "consumer_key",
        "service_name",
        "sender_id",
        "application_secret",
    ]

    def _get_signature(self, method, query, body, timestamp):
        application_secret = self.messaging_provider.application_secret or ""
        consumer_key = self.messaging_provider.consumer_key or ""

        sha1 = hashlib.sha1()
        sha1.update(
            (
                application_secret
                + "+"
                + consumer_key
                + "+"
                + method
                + "+"
                + query
                + "+"
                + body
                + "+"
                + str(timestamp)
            ).encode("utf-8")
        )
        return "$1$" + sha1.hexdigest()

    def send(self, message: "Message"):
        logger.info(f"Sending SMS via OVH to {message.phone_number}")

        phone = message.phone_number or message.sent_to.mobile_phone_number
        if not phone:
            error_msg = "Recipient phone number is required"
            logger.error(error_msg)
            message.task_logs += f"{error_msg}\n"
            message.save()
            raise Exception(error_msg)

        application_key = self.messaging_provider.application_key
        consumer_key = self.messaging_provider.consumer_key
        service_name = self.messaging_provider.service_name
        sender = self.messaging_provider.sender_id

        # sender_id is optional: when left empty, OVH picks the sender itself.
        if not all([application_key, consumer_key, service_name]):
            error_msg = "Missing OVH configuration fields (application_key, consumer_key, or service_name)"
            logger.error(error_msg)
            message.task_logs += f"{error_msg}\n"
            message.save()
            raise Exception(error_msg)

        # Trailing slash is required: OVH consumer-key access rules are matched on the
        # exact path, and the granted rule is "/sms/*/jobs/". Without the slash the
        # call is rejected with 403 NOT_GRANTED_CALL.
        url = f"https://eu.api.ovh.com/1.0/sms/{service_name}/jobs/"

        body = {
            "message": message.render_content_sms,
            "receivers": [phone],
            # senderForResponse must be False for a custom sender to be honored;
            # when True, OVH ignores "sender" and uses a short number for replies.
            "senderForResponse": False,
        }
        if sender:
            body["sender"] = sender
        else:
            # No configured sender: let OVH choose one from the account.
            body["senderForResponse"] = True

        body_json = json.dumps(body)
        timestamp = int(time.time())
        signature = self._get_signature("POST", url, body_json, timestamp)

        headers = {
            "X-Ovh-Application": application_key,
            "X-Ovh-Consumer": consumer_key,
            "X-Ovh-Timestamp": str(timestamp),
            "X-Ovh-Signature": signature,
            "Content-Type": "application/json",
        }

        logger.info(f"Sending POST request to OVH SMS API: {url}")
        # Send the exact bytes the signature was computed over (body_json), not a
        # re-serialized copy: passing json=body would let requests re-serialize the
        # dict, producing a different byte string and an INVALID_SIGNATURE error.
        response = requests.post(url, data=body_json, headers=headers)
        logger.info(f"OVH response status: {response.status_code}")

        message.task_logs += f"OVH API response: {response.status_code}\n"
        message.task_logs += f"Response body: {response.text}\n"
        message.save()

        try:
            response.raise_for_status()
            logger.info("SMS sent successfully via OVH")
        except requests.exceptions.HTTPError as e:
            error_msg = f"OVH API error: {response.status_code} - {response.text}"
            logger.error(error_msg)
            raise Exception(error_msg) from e

    def test_connection(self):
        application_key = self.messaging_provider.application_key
        consumer_key = self.messaging_provider.consumer_key
        service_name = self.messaging_provider.service_name

        if not all([application_key, consumer_key, service_name]):
            raise Exception("Missing application_key, consumer_key or service_name")

        # Use GET /sms (list the SMS services) rather than GET /sms/{service_name}:
        # the consumer key is typically granted only on /sms and /sms/*/jobs/, so
        # querying the service resource itself returns 403 NOT_GRANTED_CALL even
        # though sending (POST /sms/*/jobs/) works fine.
        url = "https://eu.api.ovh.com/1.0/sms"
        timestamp = int(time.time())
        signature = self._get_signature("GET", url, "", timestamp)

        headers = {
            "X-Ovh-Application": application_key,
            "X-Ovh-Consumer": consumer_key,
            "X-Ovh-Timestamp": str(timestamp),
            "X-Ovh-Signature": signature,
        }

        response = requests.get(url, headers=headers)
        response.raise_for_status()

        services = response.json()
        if service_name not in services:
            raise Exception(
                f"Service '{service_name}' not found in OVH account. "
                f"Available services: {services}"
            )
