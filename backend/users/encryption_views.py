"""DRF endpoints for the E2E encryption activation/recovery flow."""

import logging

from constance import config
from django.contrib.auth import get_user_model
from django.utils import translation
from rest_framework import status
from rest_framework.permissions import IsAdminUser, IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from consultations.permissions import IsPractitioner
from core.encryption import (
    decrypt_private_key_with_passphrase,
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


class EncryptionActivatePassphraseView(APIView):
    """POST {passphrase} -> returns the user's private PEM (decrypted server-side).

    Used during onboarding/first login. The browser stores the PEM in IndexedDB.
    """

    permission_classes = [IsAuthenticated]

    def post(self, request):
        guard = _require_encryption_enabled()
        if guard:
            return guard

        passphrase = request.data.get("passphrase")
        if not passphrase:
            return Response(
                {"detail": "passphrase is required"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        user = request.user
        if not user.encrypted_private_key:
            return Response(
                {"detail": "No encryption keypair provisioned for this user."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        try:
            private_pem = decrypt_private_key_with_passphrase(
                user.encrypted_private_key, passphrase
            )
        except Exception:
            return Response(
                {"detail": "Invalid passphrase."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        if user.encryption_passphrase_pending:
            user.encryption_passphrase_pending = False
            user.save(update_fields=["encryption_passphrase_pending"])

        return Response(
            {
                "private_key_pem": private_pem.decode("utf-8"),
                "public_key_pem": user.public_key,
                "public_key_fingerprint": user.public_key_fingerprint,
            }
        )


class EncryptionChangePassphraseView(APIView):
    """POST {old_passphrase, new_passphrase} -> rewraps the private key."""

    permission_classes = [IsAuthenticated]

    def post(self, request):
        guard = _require_encryption_enabled()
        if guard:
            return guard

        old_passphrase = request.data.get("old_passphrase")
        new_passphrase = request.data.get("new_passphrase")
        if not old_passphrase or not new_passphrase:
            return Response(
                {"detail": "old_passphrase and new_passphrase are required"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        user = request.user
        if not user.encrypted_private_key:
            return Response(
                {"detail": "No encryption keypair provisioned for this user."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        try:
            private_pem = decrypt_private_key_with_passphrase(
                user.encrypted_private_key, old_passphrase
            )
        except Exception:
            return Response(
                {"detail": "Invalid current passphrase."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        user.encrypted_private_key = encrypt_private_key_with_passphrase(
            private_pem, new_passphrase
        )
        user.save(update_fields=["encrypted_private_key"])
        return Response({"detail": "Passphrase updated."})


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
