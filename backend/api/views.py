from django.shortcuts import render
from rest_framework import status
from rest_framework.views import APIView
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework_simplejwt.tokens import RefreshToken
from consultations.models import Participant
from users.models import User
from drf_spectacular.utils import extend_schema
import secrets
import string


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
            'application/json': {
                'type': 'object',
                'properties': {
                    'auth_token': {
                        'type': 'string',
                        'description': 'Authentication token from participant',
                        'example': '550e8400-e29b-41d4-a716-446655440000'
                    },
                    'verification_code': {
                        'type': 'string',
                        'description': '6-digit verification code (required if token has been used)',
                        'example': '123456',
                        'minLength': 6,
                        'maxLength': 6
                    }
                },
                'required': ['auth_token']
            }
        },
        responses={
            200: {
                'description': 'Authentication successful',
                'content': {
                    'application/json': {
                        'example': {
                            'access': 'eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9...',
                            'refresh': 'eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9...',
                            'user_id': 123
                        }
                    }
                }
            },
            202: {
                'description': 'Verification code sent',
                'content': {
                    'application/json': {
                        'example': {
                            'requires_verification': True,
                            'message': 'Verification code sent. Please provide verification_code in next request.'
                        }
                    }
                }
            },
            400: {
                'description': 'Bad request',
                'content': {
                    'application/json': {
                        'examples': {
                            'missing_token': {
                                'summary': 'Missing auth token',
                                'value': {'error': 'auth_token is required'}
                            },
                            'missing_code': {
                                'summary': 'Missing verification code',
                                'value': {'error': 'verification_code is required when token has been used'}
                            }
                        }
                    }
                }
            },
            401: {
                'description': 'Unauthorized',
                'content': {
                    'application/json': {
                        'examples': {
                            'invalid_token': {
                                'summary': 'Invalid auth token',
                                'value': {'error': 'Invalid auth_token'}
                            },
                            'invalid_code': {
                                'summary': 'Invalid verification code',
                                'value': {'error': 'Invalid verification_code'}
                            }
                        }
                    }
                }
            }
        }
    )
    def post(self, request):
        auth_token = request.data.get('auth_token')
        verification_code = request.data.get('verification_code')
        
        if not auth_token:
            return Response({'error': 'auth_token is required'}, status=status.HTTP_400_BAD_REQUEST)
        
        try:
            # Look up user by appointment_auth_token
            user = User.objects.get(appointment_auth_token=auth_token)

            # Get the participant for this user (assuming one participant per user for now)
            try:
                Participant.objects.get(user=user)
            except Participant.DoesNotExist:
                return Response({'error': 'No participant found for this auth token'}, status=status.HTTP_401_UNAUTHORIZED)

            if user.is_appointment_auth_token_used:
                # Token has been used, verification code is required
                if not verification_code:
                    # Generate and save verification code on user
                    user.verification_code = int(''.join(
                        secrets.choice(string.digits) for _ in range(6)))
                    user.save()

                    return Response({
                        'requires_verification': True,
                        'message': 'Verification code sent. Please provide verification_code in next request.'
                    }, status=status.HTTP_202_ACCEPTED)

                # Verify the provided code
                if int(user.verification_code) != int(verification_code):
                    return Response({'error': 'Invalid verification_code'}, status=status.HTTP_401_UNAUTHORIZED)

                # Clear the verification code after successful verification
                user.verification_code = None
                user.save()

            else:
                # First time using the token
                user.is_appointment_auth_token_used = True
                user.save()

            # Generate JWT token for the real user
            refresh = RefreshToken.for_user(user)

            return Response({
                'access': str(refresh.access_token),
                'refresh': str(refresh),
                'user_id': user.id
            }, status=status.HTTP_200_OK)

        except User.DoesNotExist:
            return Response({'error': 'Invalid auth_token'}, status=status.HTTP_401_UNAUTHORIZED)
