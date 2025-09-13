from django.shortcuts import render
from rest_framework import status
from rest_framework.views import APIView
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework_simplejwt.tokens import RefreshToken
from consultations.models import Participant
from django.contrib.auth.models import AnonymousUser
from drf_spectacular.utils import extend_schema, OpenApiParameter, OpenApiTypes, OpenApiExample
import secrets
import string


class AnonymousTokenAuthView(APIView):
    """
    Authenticate using auth_token and return JWT token.
    If token has been used before, require code verification.
    """
    permission_classes = [AllowAny]
    
    @extend_schema(
        summary="Anonymous Token Authentication",
        description="Authenticate using auth_token and return JWT token. If token has been used before, require code verification.",
        request={
            'application/json': {
                'type': 'object',
                'properties': {
                    'auth_token': {
                        'type': 'string',
                        'description': 'Authentication token from participant',
                        'example': '550e8400-e29b-41d4-a716-446655440000'
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
                            'participant_id': 123,
                            'is_anonymous': True
                        }
                    }
                }
            },
            202: {
                'description': 'Verification required',
                'content': {
                    'application/json': {
                        'example': {
                            'requires_verification': True,
                            'message': 'Verification code required. Check your communication method.',
                            'verification_code': '123456'
                        }
                    }
                }
            },
            400: {
                'description': 'Bad request',
                'content': {
                    'application/json': {
                        'example': {'error': 'auth_token is required'}
                    }
                }
            },
            401: {
                'description': 'Unauthorized',
                'content': {
                    'application/json': {
                        'example': {'error': 'Invalid auth_token'}
                    }
                }
            }
        }
    )
    def post(self, request):

        auth_token = request.data.get('auth_token')
        
        if not auth_token:
            return Response({'error': 'auth_token is required'}, status=status.HTTP_400_BAD_REQUEST)
        
        try:
            participant = Participant.objects.get(auth_token=auth_token)
            
            if participant.is_auth_token_used:
                # Generate verification code
                participant.verification_code = ''.join(
                    secrets.choice(string.digits) for _ in range(6))
                request.session['participant_id_pending'] = participant.id
                
                return Response({
                    'requires_verification': True,
                    'message': 'Verification code required. Check your communication method.',
                }, status=status.HTTP_202_ACCEPTED)
            
            # Mark token as used
            participant.is_auth_token_used = True
            participant.save()
            
            # Use Django's AnonymousUser
            anonymous_user = AnonymousUser()
            
            # Generate JWT token for anonymous user
            refresh = RefreshToken.for_user(anonymous_user)
            refresh['participant_id'] = participant.id
            refresh['is_anonymous'] = True
            
            return Response({
                'access': str(refresh.access_token),
                'refresh': str(refresh),
                'participant_id': participant.id,
                'is_anonymous': True
            }, status=status.HTTP_200_OK)
            
        except Participant.DoesNotExist:
            return Response({'error': 'Invalid auth_token'}, status=status.HTTP_401_UNAUTHORIZED)


class VerifyCodeView(APIView):
    """
    Verify the code and return JWT token for anonymous user.
    """
    permission_classes = [AllowAny]
    
    @extend_schema(
        summary="Verify Authentication Code",
        description="Verify the 6-digit code and return JWT token for anonymous user.",
        request={
            'application/json': {
                'type': 'object',
                'properties': {
                    'verification_code': {
                        'type': 'string',
                        'description': '6-digit verification code',
                        'example': '123456',
                        'minLength': 6,
                        'maxLength': 6
                    }
                },
                'required': ['verification_code']
            }
        },
        responses={
            200: {
                'description': 'Verification successful',
                'content': {
                    'application/json': {
                        'example': {
                            'access': 'eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9...',
                            'refresh': 'eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9...',
                            'participant_id': 123,
                            'is_anonymous': True
                        }
                    }
                }
            },
            400: {
                'description': 'Bad request',
                'content': {
                    'application/json': {
                        'examples': {
                            'missing_code': {
                                'summary': 'Missing verification code',
                                'value': {'error': 'verification_code is required'}
                            },
                            'no_pending': {
                                'summary': 'No pending verification',
                                'value': {'error': 'No pending verification found'}
                            }
                        }
                    }
                }
            },
            401: {
                'description': 'Unauthorized',
                'content': {
                    'application/json': {
                        'example': {'error': 'Invalid verification code'}
                    }
                }
            }
        }
    )
    def post(self, request):
        verification_code = request.data.get('verification_code')
        
        if not verification_code:
            return Response({'error': 'verification_code is required'}, status=status.HTTP_400_BAD_REQUEST)
        
        participant_id = request.session.get('participant_id_pending')
        stored_code = request.session.get(f'verification_code_{participant_id}')
        
        if not participant_id or not stored_code:
            return Response({'error': 'No pending verification found'}, status=status.HTTP_400_BAD_REQUEST)
        
        if verification_code != stored_code:
            return Response({'error': 'Invalid verification code'}, status=status.HTTP_401_UNAUTHORIZED)
        
        try:
            participant = Participant.objects.get(id=participant_id)
            
            # Use Django's AnonymousUser
            anonymous_user = AnonymousUser()
            
            # Generate JWT token for anonymous user
            refresh = RefreshToken.for_user(anonymous_user)
            refresh['participant_id'] = participant.id
            refresh['is_anonymous'] = True
            
            # Clean up session data
            del request.session[f'verification_code_{participant_id}']
            del request.session['participant_id_pending']
            
            return Response({
                'access': str(refresh.access_token),
                'refresh': str(refresh),
                'participant_id': participant.id,
                'is_anonymous': True
            }, status=status.HTTP_200_OK)
            
        except Participant.DoesNotExist:
            return Response({'error': 'Invalid participant'}, status=status.HTTP_400_BAD_REQUEST)
