from datetime import timedelta

from constance import config
from consultations.models import Participant
from django.contrib.contenttypes.models import ContentType
from django.core import signing
from django.db import transaction
from django.shortcuts import render
from django.utils import timezone
from drf_spectacular.utils import extend_schema
from messaging.models import Message
from rest_framework import status
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView
from core.authentication import TenantRefreshToken
from core.throttling import AnonymousTokenRateThrottle
from users.models import User
from users.verification import (
    MAX_VERIFICATION_ATTEMPTS,
    TOKEN_GRACE_PERIOD,
    VERIFICATION_CODE_TTL,
    codes_match,
    read_code_login_token,
)


class IdentityView(APIView):
    """
    Public, unauthenticated endpoint that identifies the backend as a genuine
    HCW instance. Used by native apps to validate a deeplink host before
    trusting it (and before sending any credentials).
    """

    permission_classes = [AllowAny]
    authentication_classes = []

    @extend_schema(
        summary="Backend identity probe",
        description="Returns a known marker proving the host is a HCW backend.",
        responses={
            200: {
                "description": "Identity payload",
                "content": {
                    "application/json": {
                        "example": {
                            "product": "hcw",
                            "product_name": "HCW At Home",
                        }
                    }
                },
            },
        },
    )
    def get(self, request):
        from users.models import Organisation  # local import to avoid cycles

        main_org = Organisation.objects.filter(is_main=True).first()
        return Response(
            {
                "product": "hcw",
                "product_name": "HCW At Home",
                "instance_name": main_org.name if main_org else None,
                # JSON blob signed by Iabsis: {"host","exp","sig"}. Empty if not set.
                "signature": config.instance_signature or None,
            }
        )


class AnonymousTokenAuthView(APIView):
    """
    Authenticate using auth_token and return JWT token.

    ``auth_token`` is either the magic link of an invitation or notification
    (``one_time_auth_token``) or the code login token returned by
    SendVerificationCodeView. A magic link signs its holder in on its own for a
    few minutes after it is minted; past that, and always for a code login
    token, a verification code is sent and must be provided.
    """

    permission_classes = [AllowAny]
    throttle_classes = [AnonymousTokenRateThrottle]

    @extend_schema(
        summary="Anonymous Token Authentication",
        description="Authenticate using auth_token and return JWT token. Within 5 minutes of a magic link being minted, direct access is granted. After that, and always for the token returned by send-verification-code, a verification code is required.",
        request={
            "application/json": {
                "type": "object",
                "properties": {
                    "auth_token": {
                        "type": "string",
                        "description": "Magic link token of the participant, or the token returned by send-verification-code",
                        "example": "550e8400-e29b-41d4-a716-446655440000",
                    },
                    "verification_code": {
                        "type": "string",
                        "description": "6-digit verification code (required if token grace period has expired)",
                        "example": "123456",
                        "minLength": 6,
                        "maxLength": 6,
                    },
                },
                "required": ["auth_token"],
            }
        },
        responses={
            200: {
                "description": "Authentication successful",
                "content": {
                    "application/json": {
                        "example": {
                            "access": "<access-jwt-token>",
                            "refresh": "<refresh-jwt-token>",
                            "user_id": 123,
                        }
                    }
                },
            },
            202: {
                "description": "Verification code sent",
                "content": {
                    "application/json": {
                        "example": {
                            "requires_verification": True,
                            "message": "Verification code sent. Please provide verification_code in next request.",
                        }
                    }
                },
            },
            400: {
                "description": "Bad request",
                "content": {
                    "application/json": {
                        "examples": {
                            "missing_token": {
                                "summary": "Missing auth token",
                                "value": {"error": "auth_token is required"},
                            },
                        }
                    }
                },
            },
            401: {
                "description": "Unauthorized",
                "content": {
                    "application/json": {
                        "examples": {
                            "invalid_token": {
                                "summary": "Invalid auth token",
                                "value": {"error": "Invalid auth_token"},
                            },
                            "invalid_code": {
                                "summary": "Invalid verification code",
                                "value": {"error": "Invalid verification_code"},
                            },
                            "expired_code": {
                                "summary": "Expired verification code",
                                "value": {
                                    "error": "Verification code expired. Please request a new code.",
                                    "code": "verification_code_expired",
                                },
                            },
                        }
                    }
                },
            },
            429: {
                "description": "Too many attempts",
                "content": {
                    "application/json": {
                        "example": {
                            "error": "Too many verification attempts. Please request a new code."
                        }
                    }
                },
            },
        },
    )
    def post(self, request):
        auth_token = request.data.get("auth_token")
        verification_code = request.data.get("verification_code")

        if not auth_token:
            return Response(
                {"error": "auth_token is required"}, status=status.HTTP_400_BAD_REQUEST
            )

        try:
            code_login_user = read_code_login_token(auth_token)
        except signing.SignatureExpired:
            return self.code_expired()
        except signing.BadSignature:
            code_login_user = None
        is_magic_link = code_login_user is None

        with transaction.atomic():
            # Locked: concurrent requests would otherwise each mint a code, or
            # all read the same attempt counter and get far more than three
            # tries.
            users = User.objects.select_for_update()
            try:
                if is_magic_link:
                    user = users.get(one_time_auth_token=auth_token)
                else:
                    user = users.get(pk=code_login_user)
            except User.DoesNotExist:
                return Response(
                    {"error": "Invalid auth_token"},
                    status=status.HTTP_401_UNAUTHORIZED,
                )

            now = timezone.now()

            # Narrower than the "no email" test used before: an account
            # reachable by SMS now goes through the code flow, which is what
            # makes phone-only sign-up as safe as the email one.
            if is_magic_link and user.authenticates_without_code:
                # For temporary users without contact info, use longer expiry period
                token_expiry = timedelta(hours=config.temporary_participant_token_expiry_hours)
                token_valid = (
                    user.verification_code_created_at
                    and (now - user.verification_code_created_at) < token_expiry
                )

                if not token_valid:
                    return Response(
                        {"error": "Token expired. Please request a new access link."},
                        status=status.HTTP_401_UNAUTHORIZED,
                    )

                # Token is valid, authenticate directly
                user.verification_code_created_at = now
                user.save(update_fields=["verification_code_created_at"])
            elif is_magic_link and self.within_grace_period(user, now):
                user.verification_code_created_at = now
                user.save(update_fields=["verification_code_created_at"])
            else:
                rejection = self.check_code(user, verification_code, now, is_magic_link)
                if rejection is not None:
                    return rejection

            refresh = TenantRefreshToken.for_user(user)

        return Response(
            {
                "access": str(refresh.access_token),
                "refresh": str(refresh),
                "user_id": user.id,
                "tenant_id": refresh['tenant_id'],
            },
            status=status.HTTP_200_OK,
        )

    @staticmethod
    def within_grace_period(user, now):
        """Whether the magic link alone signs its holder in right now.

        The window opens when the link is minted, so a link just delivered by
        message works on the first tap, and again once it has been confirmed
        with a code. Any code issued since closes it: a pending one, and just
        as much one burnt by wrong guesses. Otherwise wrong guesses would be a
        way to get rid of the code and fall back on the link alone.
        """
        anchor = user.verification_code_created_at
        if user.verification_code is not None or not anchor:
            return False
        issued_at = user.verification_code_issued_at
        if issued_at is not None and issued_at >= anchor:
            return False
        return now - anchor < TOKEN_GRACE_PERIOD

    def check_code(self, user, verification_code, now, is_magic_link):
        """Send the code or check it; return the answer unless it signs in."""
        if not verification_code:
            # The same code goes out again while it is fresh, and nothing at
            # all within the resend delay: a reloaded page or a second tab must
            # not invalidate the code the person is about to type.
            if user.issue_verification_code(keep_auth_token=True):
                Message.objects.create(
                    sent_to=user,
                    template_system_name="your_authentication_code",
                    content_type=ContentType.objects.get_for_model(user),
                    object_id=user.pk,
                )
            return Response(
                {
                    "requires_verification": True,
                    "message": "Verification code sent. Please provide verification_code in next request.",
                },
                status=status.HTTP_202_ACCEPTED,
            )

        if user.verification_attempts >= MAX_VERIFICATION_ATTEMPTS:
            user.verification_code = None
            user.received_messages.filter(
                template_system_name="your_authentication_code"
            ).delete()
            user.verification_attempts = 0
            user.save(update_fields=["verification_code", "verification_attempts"])
            return Response(
                {"error": "Too many verification attempts. Please request a new code."},
                status=status.HTTP_429_TOO_MANY_REQUESTS,
            )

        if (
            user.verification_code is None
            or not user.verification_code_issued_at
            or now - user.verification_code_issued_at > VERIFICATION_CODE_TTL
        ):
            return self.code_expired()

        if not codes_match(user.verification_code, verification_code):
            user.verification_attempts += 1
            user.save(update_fields=["verification_attempts"])
            return Response(
                {"error": "Invalid verification_code"},
                status=status.HTTP_401_UNAUTHORIZED,
            )

        user.verification_code = None
        user.received_messages.filter(
            template_system_name="your_authentication_code"
        ).delete()
        user.verification_attempts = 0
        update_fields = ["verification_code", "verification_attempts"]
        # A magic link just confirmed with its code works on its own for a few
        # minutes. Not after a code login token: that one went to whoever typed
        # the address, and confirming it says nothing about the link.
        if is_magic_link:
            user.verification_code_created_at = now
            update_fields.append("verification_code_created_at")
        user.save(update_fields=update_fields)
        return None

    @staticmethod
    def code_expired():
        """Distinct from a wrong code, so the apps can say a new one is needed."""
        return Response(
            {
                "error": "Verification code expired. Please request a new code.",
                "code": "verification_code_expired",
            },
            status=status.HTTP_401_UNAUTHORIZED,
        )
