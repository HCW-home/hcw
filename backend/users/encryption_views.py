"""DRF endpoints for the E2E encryption activation/recovery flow.

Design note — passphrase handling
=================================
The passphrase NEVER reaches the server. The user's encrypted private key
blob is exposed via ``GET /api/auth/user/`` (only to the user themselves)
and the browser derives the KEK + decrypts locally via WebCrypto. The
endpoints below are limited to:

* ``POST /api/auth/encryption/mark-activated/`` — clears the
  ``encryption_passphrase_pending`` flag once the client has successfully
  decrypted the blob in-browser. No payload.
* ``POST /api/auth/encryption/update-encrypted-private-key/`` — accepts a
  brand-new encrypted blob (the result of re-wrapping client-side under a
  new passphrase). No passphrase ever transits the wire.

``EncryptionForgotPassphraseView`` / ``RegenerateUserKeyView`` keep the
admin-assisted recovery path: when a user genuinely lost their passphrase
the only way back is for the server to mint a fresh keypair. That path is
explicit and documented.
"""

import logging

from constance import config
from django.contrib.auth import get_user_model
from rest_framework import status
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from core.encryption import (
    encrypt_private_key_with_passphrase,
    fingerprint_public_key,
    generate_passphrase,
    generate_rsa_keypair,
)

logger = logging.getLogger(__name__)
User = get_user_model()


def _require_encryption_enabled():
    if not config.encryption_enabled:
        return Response(
            {"detail": "Encryption is not enabled on this platform."},
            status=status.HTTP_400_BAD_REQUEST,
        )
    return None


class EncryptionMarkActivatedView(APIView):
    """POST -> clears encryption_passphrase_pending.

    Called by the browser once it has successfully decrypted the user's
    private key client-side from the encrypted_private_key blob exposed on
    /auth/user/. No payload — possessing a valid JWT is enough.
    """

    permission_classes = [IsAuthenticated]

    def post(self, request):
        guard = _require_encryption_enabled()
        if guard:
            return guard

        user = request.user
        if user.encryption_passphrase_pending:
            user.encryption_passphrase_pending = False
            user.save(update_fields=["encryption_passphrase_pending"])
        return Response({"detail": "Activated."})


class EncryptionUpdateEncryptedPrivateKeyView(APIView):
    """POST {encrypted_private_key} -> persists a re-wrapped blob.

    The new blob has been produced client-side by re-encrypting the user's
    private key under a new passphrase (PBKDF2 + AES-GCM, same format as
    the existing User.encrypted_private_key field). The server only stores
    it; it never sees the old or new passphrase.
    """

    permission_classes = [IsAuthenticated]

    def post(self, request):
        guard = _require_encryption_enabled()
        if guard:
            return guard

        blob = request.data.get("encrypted_private_key")
        if not isinstance(blob, str) or not blob.strip():
            return Response(
                {"detail": "encrypted_private_key is required"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        # Light shape check — must be valid JSON with the expected keys.
        try:
            import json
            data = json.loads(blob)
            for field in ("salt", "iv", "ciphertext"):
                if not isinstance(data.get(field), str) or not data[field]:
                    raise ValueError(f"missing field {field}")
        except (ValueError, TypeError):
            return Response(
                {"detail": "encrypted_private_key is malformed"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        user = request.user
        user.encrypted_private_key = blob
        user.save(update_fields=["encrypted_private_key"])
        return Response({"detail": "Encrypted private key updated."})


class EncryptionForgotPassphraseView(APIView):
    """POST -> generates a brand-new keypair, returns the new passphrase ONCE.

    Marks `encryption_key_lost=True` so practitioners see the "Resync" banner
    on existing encrypted consultations and re-wrap their sym_key for the
    new public key.
    """

    permission_classes = [IsAuthenticated]

    def post(self, request):
        guard = _require_encryption_enabled()
        if guard:
            return guard

        return _regenerate_keypair(request.user, mark_lost=True)


class RegenerateUserKeyView(APIView):
    """POST /api/users/<id>/regenerate-encryption-key/

    Admin-or-practitioner action to regenerate a user's keypair when they
    can't (or won't) do it themselves. Returns the new passphrase ONCE.
    """

    permission_classes = [IsAuthenticated]

    def post(self, request, user_id):
        guard = _require_encryption_enabled()
        if guard:
            return guard

        if not (request.user.is_staff or getattr(request.user, "is_practitioner", False)):
            return Response(
                {"detail": "Insufficient permissions."},
                status=status.HTTP_403_FORBIDDEN,
            )

        try:
            target = User.objects.get(pk=user_id)
        except User.DoesNotExist:
            return Response(status=status.HTTP_404_NOT_FOUND)

        return _regenerate_keypair(target, mark_lost=True)


def _regenerate_keypair(user, mark_lost: bool):
    private_pem, public_pem = generate_rsa_keypair()
    passphrase = generate_passphrase()
    public_pem_str = public_pem.decode("utf-8")

    user.public_key = public_pem_str
    user.public_key_fingerprint = fingerprint_public_key(public_pem_str)
    user.encrypted_private_key = encrypt_private_key_with_passphrase(
        private_pem, passphrase
    )
    user.encryption_passphrase_pending = True
    user.encryption_key_lost = mark_lost
    user.save(
        update_fields=[
            "public_key",
            "public_key_fingerprint",
            "encrypted_private_key",
            "encryption_passphrase_pending",
            "encryption_key_lost",
        ]
    )

    return Response(
        {
            "passphrase": passphrase,
            "public_key_fingerprint": user.public_key_fingerprint,
            "detail": (
                "New passphrase generated. Save it now — it is shown only once. "
                "Existing encrypted consultations will need to be re-wrapped "
                "by another member or by an admin via the master key."
            ),
        }
    )
