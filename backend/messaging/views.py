"""Public endpoints of the messaging app.

Both views are reachable without authentication and are addressed by an opaque
per-message token (`Message.link_token`):

- the redirector backs WhatsApp call-to-action buttons, whose URL must be a
  static base with a variable suffix;
- the Twilio callback reports delivery progress, authenticated by the provider
  signature rather than by a session.
"""

import base64
import hashlib
import hmac
import logging

from constance import config
from django.http import Http404, HttpResponse, HttpResponseForbidden, HttpResponseRedirect
from django.views.decorators.csrf import csrf_exempt
from django.views.decorators.http import require_POST
from django.utils import timezone

from .models import CommunicationMethod, Message, MessageStatus, MessagingProvider

logger = logging.getLogger(__name__)

# Twilio delivery states mapped onto our own. `queued`, `sending` and `sent`
# carry no new information: the provider already set the message to `sent`.
TWILIO_STATUS_MAP = {
    "delivered": MessageStatus.delivered,
    "read": MessageStatus.read,
    "failed": MessageStatus.failed,
    "undelivered": MessageStatus.failed,
}

# A callback for an earlier state can arrive after a later one; never regress.
STATUS_RANK = {
    MessageStatus.pending: 0,
    MessageStatus.sending: 1,
    MessageStatus.sent: 2,
    MessageStatus.delivered: 3,
    MessageStatus.read: 4,
    MessageStatus.failed: 5,
}


def message_redirect(request, token):
    """Resolve a WhatsApp button token to the deep link frozen at send time."""
    message = Message.objects.filter(link_token=token).first()
    if not message or not message.link_target:
        logger.warning("Unknown or link-less message token: %s", token)
        raise Http404

    return HttpResponseRedirect(message.link_target)


def _expected_signature(auth_token: str, url: str, post_data) -> str:
    """Rebuild Twilio's HMAC-SHA1 of the callback URL and its sorted parameters."""
    payload = url
    for key in sorted(post_data.keys()):
        payload += key + post_data[key]
    digest = hmac.new(
        auth_token.encode("utf-8"), payload.encode("utf-8"), hashlib.sha1
    ).digest()
    return base64.b64encode(digest).decode()


def _signature_is_valid(request, message) -> bool:
    """Check X-Twilio-Signature against the auth token of a WhatsApp provider.

    The URL is rebuilt from `backend_base_url` instead of the request, because
    that is exactly the value handed to Twilio as StatusCallback and it is
    immune to proxy header rewriting.
    """
    signature = request.headers.get("X-Twilio-Signature", "")
    if not signature:
        return False

    url = f"{(config.backend_base_url or '').rstrip('/')}{request.path}"

    candidates = list(
        MessagingProvider.objects.filter(
            communication_method=CommunicationMethod.whatsapp
        )
        .exclude(auth_token__isnull=True)
        .exclude(auth_token="")
    )
    # The provider that sent the message is the expected signer, try it first.
    candidates.sort(key=lambda p: p.name != message.provider_name)

    for provider in candidates:
        if hmac.compare_digest(
            _expected_signature(provider.auth_token, url, request.POST), signature
        ):
            return True
    return False


@csrf_exempt
@require_POST
def twilio_status_callback(request, token):
    """Apply a Twilio delivery status callback to the matching message."""
    message = Message.objects.filter(link_token=token).first()
    if not message:
        # Nothing to update, but do not let Twilio retry forever.
        logger.info("Twilio status callback for unknown token: %s", token)
        return HttpResponse(status=200)

    if not _signature_is_valid(request, message):
        logger.warning("Rejected Twilio status callback with invalid signature: %s", token)
        return HttpResponseForbidden("Invalid signature")

    twilio_status = request.POST.get("MessageStatus", "").lower()
    new_status = TWILIO_STATUS_MAP.get(twilio_status)
    if not new_status:
        logger.debug("Ignoring Twilio status '%s' for message %s", twilio_status, message.pk)
        return HttpResponse(status=200)

    update_fields = []

    if STATUS_RANK.get(new_status, 0) > STATUS_RANK.get(message.status, 0):
        message.status = new_status
        update_fields.append("status")

    now = timezone.now()
    if new_status == MessageStatus.delivered and not message.delivered_at:
        message.delivered_at = now
        update_fields.append("delivered_at")
    elif new_status == MessageStatus.read:
        if not message.delivered_at:
            message.delivered_at = now
            update_fields.append("delivered_at")
        if not message.read_at:
            message.read_at = now
            update_fields.append("read_at")
    elif new_status == MessageStatus.failed:
        if not message.failed_at:
            message.failed_at = now
            update_fields.append("failed_at")
        error_code = request.POST.get("ErrorCode", "")
        error_message = request.POST.get("ErrorMessage", "")
        if error_code or error_message:
            message.error_message = f"{error_code} {error_message}".strip()
            update_fields.append("error_message")

    external_id = request.POST.get("MessageSid", "")
    if external_id and not message.external_message_id:
        message.external_message_id = external_id
        update_fields.append("external_message_id")

    if update_fields:
        message.save(update_fields=update_fields + ["updated_at"])

    return HttpResponse(status=200)
