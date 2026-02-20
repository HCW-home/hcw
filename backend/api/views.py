import secrets

from consultations.models import Participant
from django.conf import settings as django_settings
from django.shortcuts import render
from drf_spectacular.utils import extend_schema
from messaging.models import Message
from rest_framework import status
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework_simplejwt.tokens import RefreshToken
from users.models import User

MAX_VERIFICATION_ATTEMPTS = getattr(django_settings, "MAX_VERIFICATION_ATTEMPTS", 3)


class AnonymousTokenAuthView(APIView):
    """
    Authenticate using auth_token and return JWT token.
    verification_code is optional but required if is_auth_token_used is true.
    """

    permission_classes = [AllowAny]

    @extend_schema(
        summary="Anonymous Token Authentication",
        description="Authenticate using auth_token and return JWT token. If token has been used before, verification_code is required.",
        request={
            "application/json": {
                "type": "object",
                "properties": {
                    "auth_token": {
                        "type": "string",
                        "description": "Authentication token from participant",
                        "example": "550e8400-e29b-41d4-a716-446655440000",
                    },
                    "verification_code": {
                        "type": "string",
                        "description": "6-digit verification code (required if token has been used)",
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
                            "access": "eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9...",
                            "refresh": "eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9...",
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
                            "missing_code": {
                                "summary": "Missing verification code",
                                "value": {
                                    "error": "verification_code is required when token has been used"
                                },
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
            # Look up user by auth_token
            user = User.objects.get(one_time_auth_token=auth_token)

            if user.is_auth_token_used:
                # Token has been used, verification code is required
                if not verification_code:
                    # Generate and save verification code on user
                    user.verification_code = secrets.randbelow(1000000)
                    user.verification_attempts = 0
                    user.save(update_fields=["verification_code", "verification_attempts"])

                    Message.objects.create(
                        sent_to=user,
                        template_system_name="your_authentication_code",
                        object_pk=user.pk,
                        object_model="users.User",
                    )

                    return Response(
                        {
                            "requires_verification": True,
                            "message": "Verification code sent. Please provide verification_code in next request.",
                        },
                        status=status.HTTP_202_ACCEPTED,
                    )

                # Check if max attempts exceeded
                if user.verification_attempts >= MAX_VERIFICATION_ATTEMPTS:
                    user.verification_code = None
                    user.verification_attempts = 0
                    user.save(update_fields=["verification_code", "verification_attempts"])
                    return Response(
                        {"error": "Too many verification attempts. Please request a new code."},
                        status=status.HTTP_429_TOO_MANY_REQUESTS,
                    )

                # Verify the provided code (pad both to 6 digits for comparison)
                if str(user.verification_code).zfill(6) != str(verification_code).zfill(6):
                    user.verification_attempts += 1
                    user.save(update_fields=["verification_attempts"])
                    return Response(
                        {"error": "Invalid verification_code"},
                        status=status.HTTP_401_UNAUTHORIZED,
                    )

                # Clear the verification code after successful verification
                user.verification_code = None
                user.verification_attempts = 0
                user.save(update_fields=["verification_code", "verification_attempts"])

            else:
                # First time using the token
                user.is_auth_token_used = True
                user.save()

            # Generate JWT token for the real user
            refresh = RefreshToken.for_user(user)

            return Response(
                {
                    "access": str(refresh.access_token),
                    "refresh": str(refresh),
                    "user_id": user.id,
                },
                status=status.HTTP_200_OK,
            )

        except User.DoesNotExist:
            return Response(
                {"error": "Invalid auth_token"}, status=status.HTTP_401_UNAUTHORIZED
            )
