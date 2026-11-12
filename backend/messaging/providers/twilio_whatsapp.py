import base64
import json
import logging
import re
from typing import TYPE_CHECKING, Any, Dict, List, Optional, Tuple

import requests
from constance import config
from django.conf import settings
from django.utils import timezone

from . import BaseMessagingProvider
from ..whatsapp_content import (
    LINK_TOKEN_EXPRESSION,
    build_content,
    check_meta_compliance,
    render_examples,
    render_variables,
)

logger = logging.getLogger(__name__)

CONTENT_API_URL = "https://content.twilio.com/v1/Content"
MESSAGES_API_URL = "https://api.twilio.com/2010-04-01/Accounts/{account_sid}/Messages.json"

# WhatsApp caps call-to-action button labels at 20 characters.
BUTTON_TITLE_MAX_LENGTH = 20

# Meta template names and Twilio friendly names accept lowercase alphanumerics
# and underscores only.
_UNSAFE_NAME_RE = re.compile(r"[^a-z0-9_]+")


class ProviderException(Exception): ...


if TYPE_CHECKING:
    from ..models import Message, TemplateValidation


def _safe_name(value: str) -> str:
    return _UNSAFE_NAME_RE.sub("_", value.lower()).strip("_")


class Main(BaseMessagingProvider):
    display_name = "Twilio WhatsApp"
    communication_method = "whatsapp"
    required_fields = [
        "account_sid",
        "auth_token",
        "from_phone",
        "excluded_prefixes",
        "included_prefixes",
    ]

    def _get_auth_header(self):
        account_sid = self.messaging_provider.account_sid
        auth_token = self.messaging_provider.auth_token
        if not account_sid or not auth_token:
            return None
        credentials = f"{account_sid}:{auth_token}"
        encoded_credentials = base64.b64encode(credentials.encode()).decode()
        return f"Basic {encoded_credentials}"

    @staticmethod
    def _whatsapp_address(phone: str) -> str:
        """Twilio addresses WhatsApp endpoints with a `whatsapp:` scheme."""
        phone = (phone or "").strip()
        if phone.startswith("whatsapp:"):
            return phone
        return f"whatsapp:{phone}"

    @staticmethod
    def _backend_base_url() -> str:
        base = (config.backend_base_url or "").strip().rstrip("/")
        if not base:
            raise ProviderException(
                "backend_base_url is not configured, WhatsApp links and delivery "
                "callbacks cannot be built"
            )
        return base

    # ------------------------------------------------------------------ send

    @staticmethod
    def _language_candidates(language: str) -> List[str]:
        """Preferred language first, then its base form, then the site default."""
        candidates: List[str] = []
        for lang in (
            language,
            (language or "").split("-")[0],
            settings.LANGUAGE_CODE,
            settings.LANGUAGE_CODE.split("-")[0],
        ):
            if lang and lang not in candidates:
                candidates.append(lang)
        return candidates

    def _resolve_validation(self, message: "Message") -> Optional["TemplateValidation"]:
        """Find the approved template to use for this message, if any."""
        from ..models import TemplateValidation, TemplateValidationStatus

        approved = TemplateValidation.objects.filter(
            messaging_provider=self.messaging_provider,
            event_type=message.template_system_name,
            status=TemplateValidationStatus.validated,
        ).exclude(external_template_id="")

        by_language = {validation.language_code: validation for validation in approved}
        for language in self._language_candidates(message.language):
            if language in by_language:
                return by_language[language]
        return None

    def _status_callback_url(self, message: "Message") -> Optional[str]:
        try:
            base = self._backend_base_url()
        except ProviderException:
            return None
        if not message.link_token:
            return None
        return f"{base}/messaging/twilio/status/{message.link_token}"

    def send(self, message: "Message"):
        logger.info(f"Sending WhatsApp via Twilio to {message.phone_number}")

        if not message.phone_number:
            raise ProviderException("Missing recipient phone")

        if not self.messaging_provider.matches_phone_prefix(message.phone_number):
            raise ProviderException(
                f"Unable to send, phone is not matching prefix {message.phone_number}"
            )

        auth_header = self._get_auth_header()
        if not auth_header:
            raise ProviderException(
                "Missing Twilio credentials (account_sid or auth_token)"
            )

        from_phone = self.messaging_provider.from_phone
        if not from_phone:
            raise ProviderException("Missing from_phone configuration")

        # Outside the 24h customer service window WhatsApp only accepts
        # pre-approved templates, so we never attempt a free-form send: failing
        # here costs no API call and lets the dispatcher fall back to SMS.
        if not message.template_system_name:
            raise ProviderException(
                "WhatsApp requires an approved template, this message has no template"
            )

        validation = self._resolve_validation(message)
        if not validation:
            raise ProviderException(
                f"No approved WhatsApp template for '{message.template_system_name}' "
                f"in language '{message.language}'"
            )

        if validation.is_outdated:
            raise ProviderException(
                f"Approved WhatsApp template for '{message.template_system_name}' "
                f"[{validation.language_code}] no longer matches the current template "
                "content, resubmit it for validation"
            )

        # The approved template froze a placeholder ordering; replay the exact
        # one that was submitted. Validations approved before the ordering was
        # persisted, or drifting from the current template, would silently send
        # wrong or empty values.
        expressions = validation.variable_expressions or []
        _, expected_expressions = build_content(
            validation.template,
            validation.language_code,
            with_action=bool(validation.template.action),
        )
        if expressions != expected_expressions:
            raise ProviderException(
                f"Approved WhatsApp template for '{message.template_system_name}' "
                f"[{validation.language_code}] does not match the current template "
                "variables, resubmit it for validation"
            )

        message.ensure_link_token()
        if LINK_TOKEN_EXPRESSION in expressions:
            message.freeze_access_link()
        # Persist the token before calling Twilio: the delivery callback may
        # land before the response is even processed.
        message.save()

        variables = render_variables(message, expressions)

        data = {
            "From": self._whatsapp_address(from_phone),
            "To": self._whatsapp_address(message.phone_number),
            "ContentSid": validation.external_template_id,
        }
        if variables:
            data["ContentVariables"] = json.dumps(variables)

        status_callback = self._status_callback_url(message)
        if status_callback:
            data["StatusCallback"] = status_callback

        headers = {
            "Authorization": auth_header,
            "Content-Type": "application/x-www-form-urlencoded",
        }

        url = MESSAGES_API_URL.format(
            account_sid=self.messaging_provider.account_sid
        )
        logger.info(f"Sending POST request to Twilio Messages API: {url}")
        response = requests.post(url, data=data, headers=headers)
        logger.info(f"Twilio response status: {response.status_code}")

        message.task_logs += (
            f"Twilio WhatsApp API response: {response.status_code}\n"
            f"Content template: {validation.external_template_id} "
            f"[{validation.language_code}]\n"
            f"Response body: {response.text}\n"
        )

        if response.status_code != 201:
            message.save()
            raise ProviderException(
                f"Twilio API error: {response.status_code} - {response.text}"
            )

        response_data = response.json() if response.content else {}
        # provider_name and sent_at are stamped by the dispatcher on success.
        message.external_message_id = response_data.get("sid", "")
        message.save()
        logger.info("WhatsApp message sent successfully via Twilio")

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

            headers = {"Authorization": auth_header}
            response = requests.get(url, headers=headers)

            if response.status_code == 200:
                return (True, True)
            else:
                return (False, f"Twilio API error: {response.status_code}")

        except Exception as e:
            return (False, str(e))

    # ------------------------------------------------------- template review

    def validate_template(self, template_validation: "TemplateValidation"):
        """Create the Twilio Content Template and submit it to WhatsApp."""
        from ..models import TemplateValidationStatus

        event_type = template_validation.event_type
        language = template_validation.language_code
        logger.info(
            f"Starting template validation for: {event_type} (language: {language})"
        )

        auth_header = self._get_auth_header()
        if not auth_header:
            template_validation.task_logs += (
                "Missing Twilio credentials (account_sid or auth_token)\n"
            )
            template_validation.status = TemplateValidationStatus.failed
            template_validation.save()
            return

        template = template_validation.template
        has_action = bool(template.action)

        body, expressions = build_content(template, language, with_action=has_action)

        # Fail here rather than burning a submission: Meta answers hours later
        # and its own message ("Invalid parameter") does not say which template.
        problems = check_meta_compliance(body)
        if problems:
            template_validation.task_logs += (
                "Not submitted, WhatsApp would reject this template:\n"
                + "".join(f"  - {problem}\n" for problem in problems)
                + f"  body: {body}\n"
            )
            template_validation.variable_expressions = expressions
            template_validation.status = TemplateValidationStatus.failed
            template_validation.save()
            return

        example_factory = template.factory_instance
        example_obj = example_factory.build() if example_factory else None
        if not example_obj:
            template_validation.task_logs += (
                f"Warning: no factory found for model '{template.model}', sample "
                "values sent to Meta will be generic\n"
            )
        examples = render_examples(expressions, example_obj)

        if has_action:
            action_label = str(template.action_label or "")
            if len(action_label) > BUTTON_TITLE_MAX_LENGTH:
                logger.warning(
                    f"Action label too long ({len(action_label)} chars), truncating "
                    f"to {BUTTON_TITLE_MAX_LENGTH} chars"
                )
                action_label = action_label[:BUTTON_TITLE_MAX_LENGTH]

            # WhatsApp only allows a variable at the very end of a button URL, and
            # an approved template carries a single static base. Pointing at the
            # backend redirector keeps one base for patients and practitioners
            # alike.
            link_index = expressions.index(LINK_TOKEN_EXPRESSION) + 1
            button_url = "%s/r/%s" % (
                self._backend_base_url(),
                "{{%d}}" % link_index,
            )
            types = {
                "twilio/call-to-action": {
                    "body": body,
                    "actions": [
                        {
                            "type": "URL",
                            "title": action_label,
                            "url": button_url,
                        }
                    ],
                }
            }
        else:
            button_url = None
            types = {"twilio/text": {"body": body}}

        content_data = {
            "friendly_name": _safe_name(f"{event_type}_{language}"),
            "language": language,
            "variables": examples,
            "types": types,
        }

        logger.info(f"Content data to send: {json.dumps(content_data, indent=2)}")

        headers = {"Authorization": auth_header, "Content-Type": "application/json"}

        logger.info(f"Sending POST request to Twilio Content API: {CONTENT_API_URL}")
        response = requests.post(CONTENT_API_URL, json=content_data, headers=headers)
        logger.info(f"Twilio response status: {response.status_code}")
        logger.debug(f"Twilio response content: {response.text}")

        response_data = response.json() if response.content else {}

        template_validation.validation_response = response_data
        template_validation.variable_expressions = expressions

        if response.status_code >= 400:
            logger.error(
                f"Twilio API error: {response_data.get('message', 'Unknown error')}"
            )
            template_validation.task_logs += (
                f"Content creation failed: {response.status_code} - {response.text}\n"
            )
            template_validation.status = TemplateValidationStatus.failed
            template_validation.save()
            return

        template_validation.external_template_id = response_data.get("sid", "")
        logger.info(
            f"Template external_template_id: {template_validation.external_template_id}"
        )
        if button_url:
            template_validation.task_logs += f"Button URL: {button_url}\n"

        if not template_validation.external_template_id:
            logger.warning("No external_template_id found, skipping WhatsApp submission")
            template_validation.task_logs += (
                "Content created but Twilio returned no SID, skipping WhatsApp "
                "submission\n"
            )
            template_validation.status = TemplateValidationStatus.failed
            template_validation.save()
            return

        logger.info("Submitting template to WhatsApp for approval")
        if not self._submit_template_to_whatsapp(template_validation, auth_header):
            return

        template_validation.status = TemplateValidationStatus.pending
        template_validation.save()
        logger.info(
            f"Template validation saved with status: {template_validation.status}"
        )

    def _submit_template_to_whatsapp(
        self, template_validation: "TemplateValidation", auth_header: str
    ) -> bool:
        """Submit the created Content Template to WhatsApp for approval."""
        from ..models import TemplateValidationStatus

        content_sid = template_validation.external_template_id
        url = f"{CONTENT_API_URL}/{content_sid}/ApprovalRequests/whatsapp"

        logger.info(f"Submitting template to WhatsApp: content_sid={content_sid}")

        headers = {"Authorization": auth_header, "Content-Type": "application/json"}

        # Valid categories: UTILITY (transactional), MARKETING, AUTHENTICATION (OTP)
        payload = {
            "name": _safe_name(template_validation.event_type),
            "category": "UTILITY",
        }

        try:
            response = requests.post(url, json=payload, headers=headers)
            logger.info(f"WhatsApp submission response status: {response.status_code}")
            logger.debug(f"WhatsApp submission response content: {response.text}")

            response_data = response.json() if response.content else {}

            template_validation.validation_response = {
                **(template_validation.validation_response or {}),
                "whatsapp_submission": response_data,
            }

            if response.status_code >= 400:
                logger.error(
                    "WhatsApp submission failed with error: "
                    f"{response_data.get('message', 'Unknown error')}"
                )
                template_validation.task_logs += (
                    f"WhatsApp submission failed: {response.status_code} - "
                    f"{response.text}\n"
                )
                template_validation.status = TemplateValidationStatus.failed
                template_validation.save()
                return False

            template_validation.save()
            logger.info("WhatsApp submission successful, validation response updated")
            return True

        except Exception as e:
            logger.error(f"WhatsApp submission failed with exception: {e}", exc_info=True)
            template_validation.validation_response = {
                **(template_validation.validation_response or {}),
                "whatsapp_submission_error": str(e),
            }
            template_validation.task_logs += f"WhatsApp submission failed: {e}\n"
            template_validation.status = TemplateValidationStatus.failed
            template_validation.save()
            return False

    def check_template_validation(self, template_validation: "TemplateValidation"):
        """Refresh the WhatsApp approval status of a submitted template."""
        from ..models import TemplateValidationStatus

        auth_header = self._get_auth_header()
        if not auth_header:
            template_validation.task_logs += (
                "Missing Twilio credentials (account_sid or auth_token)\n"
            )
            template_validation.status = TemplateValidationStatus.failed
            template_validation.save()
            return

        if not template_validation.external_template_id:
            template_validation.task_logs += (
                "No external template ID, submit the template for validation first\n"
            )
            return

        url = f"{CONTENT_API_URL}/{template_validation.external_template_id}"
        headers = {"Authorization": auth_header}
        response = requests.get(url, headers=headers)
        response_data = response.json() if response.content else {}

        logger.info(f"Check validation response: {json.dumps(response_data, indent=2)}")

        if response.status_code >= 400:
            template_validation.task_logs += (
                f"Status check failed: {response.status_code} - {response.text}\n"
            )
            template_validation.status = TemplateValidationStatus.failed
            template_validation.save()
            return

        approval_fetch_url = response_data.get("links", {}).get("approval_fetch")

        status = ""
        rejection_reason = ""
        approval_data: Dict[str, Any] = {}
        if approval_fetch_url:
            logger.info(f"Fetching approval requests from: {approval_fetch_url}")
            approval_response = requests.get(approval_fetch_url, headers=headers)
            approval_data = approval_response.json() if approval_response.content else {}
            logger.info(f"Approval requests response: {json.dumps(approval_data, indent=2)}")

            whatsapp_data = approval_data.get("whatsapp", {})
            status = whatsapp_data.get("status", "").lower()
            rejection_reason = whatsapp_data.get("rejection_reason") or ""
            logger.info(f"WhatsApp approval status: {status}")
        else:
            logger.warning("No approval_fetch URL found in response")

        if status == "approved":
            template_validation.status = TemplateValidationStatus.validated
            if not template_validation.validated_at:
                template_validation.validated_at = timezone.now()
        elif status == "pending":
            template_validation.status = TemplateValidationStatus.pending
        elif status == "rejected":
            template_validation.status = TemplateValidationStatus.rejected
            # Keep a dated trace: the next check overwrites the approval payload,
            # and Meta drops the reason once the template is resubmitted.
            template_validation.task_logs += (
                f"Rejected by WhatsApp: {rejection_reason or 'no reason given'}\n"
            )
        else:
            logger.warning(f"Unknown or missing WhatsApp approval status: {status}")
            template_validation.task_logs += (
                "No WhatsApp approval status returned by Twilio\n"
            )
            if (
                not template_validation.status
                or template_validation.status == TemplateValidationStatus.created
            ):
                template_validation.status = TemplateValidationStatus.created

        # Merge rather than overwrite so the submission trace is not lost.
        template_validation.validation_response = {
            **(template_validation.validation_response or {}),
            **response_data,
            "whatsapp_approval": approval_data,
        }
        template_validation.save()
