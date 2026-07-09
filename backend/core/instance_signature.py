"""Verify the Iabsis instance-certification signature.

An instance is "certified" when its `instance_signature` Constance value is a
JSON blob {"host","exp","sig"} whose Ed25519 signature over the canonical
message `f"{host}\\n{exp}"` verifies against the Iabsis public key, is not
expired, and whose host matches the request host.

This mirrors the native app's DeeplinkService.validateHost so the patient web
app only offers to open/install the native app on a trusted instance.
"""

import base64
import json
import time

from cryptography.exceptions import InvalidSignature
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PublicKey
from django.conf import settings


def _canonical_message(host: str, exp: int) -> bytes:
    # Must stay identical to hcw_sign._canonical_message and the native verifier.
    return f"{host}\n{exp}".encode("utf-8")


def is_instance_certified(signature_blob: str, request_host: str) -> bool:
    """Return True iff signature_blob certifies request_host and is still valid.

    signature_blob: the raw `instance_signature` Constance value (may be empty).
    request_host: the host the client reached us on (e.g. request.get_host()),
        without port — matched case-insensitively against the signed host.
    """
    if not signature_blob:
        return False

    pub_b64 = settings.IABSIS_PUBLIC_KEY_B64
    if not pub_b64:
        return False

    try:
        blob = json.loads(signature_blob)
    except (ValueError, TypeError):
        return False

    host = blob.get("host")
    exp = blob.get("exp")
    sig = blob.get("sig")
    if not host or not sig or not isinstance(exp, int):
        return False

    # Host must match the instance we were reached on (strip any port).
    reached = (request_host or "").split(":")[0].lower()
    if host.lower() != reached:
        return False

    # Not expired.
    if time.time() >= exp:
        return False

    try:
        public_key = Ed25519PublicKey.from_public_bytes(base64.b64decode(pub_b64))
        public_key.verify(base64.b64decode(sig), _canonical_message(host, exp))
    except (InvalidSignature, ValueError, TypeError):
        return False

    return True
