from django.shortcuts import render
from rest_framework import status
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework_simplejwt.tokens import RefreshToken
from consultations.models import Participant
from django.contrib.auth import get_user_model
import secrets
import string

User = get_user_model()

@api_view(['POST'])
@permission_classes([AllowAny])
def anonymous_token_auth(request):
    """
    Authenticate using auth_token and return JWT token.
    If token has been used before, require code verification.
    """
    auth_token = request.data.get('auth_token')
    
    if not auth_token:
        return Response({'error': 'auth_token is required'}, status=status.HTTP_400_BAD_REQUEST)
    
    try:
        participant = Participant.objects.get(auth_token=auth_token)
        
        if participant.is_auth_token_used:
            # Generate verification code
            verification_code = ''.join(secrets.choice(string.digits) for _ in range(6))
            # Store the code temporarily (you might want to use cache or add a field to store this)
            # For now, we'll use a simple approach - you can enhance this with Redis cache
            request.session[f'verification_code_{participant.id}'] = verification_code
            request.session[f'participant_id_pending'] = participant.id
            
            return Response({
                'requires_verification': True,
                'message': 'Verification code required. Check your communication method.',
                'verification_code': verification_code  # In production, send this via SMS/email
            }, status=status.HTTP_202_ACCEPTED)
        
        # Mark token as used and create anonymous user session
        participant.is_auth_token_used = True
        participant.save()
        
        # Create or get anonymous user for this participant
        anonymous_username = f"anonymous_participant_{participant.id}"
        user, created = User.objects.get_or_create(
            username=anonymous_username,
            defaults={
                'email': participant.email or '',
                'is_active': True,
                'first_name': 'Anonymous',
                'last_name': 'User'
            }
        )
        
        # Generate JWT token
        refresh = RefreshToken.for_user(user)
        
        return Response({
            'access': str(refresh.access_token),
            'refresh': str(refresh),
            'participant_id': participant.id,
            'user_id': user.id
        }, status=status.HTTP_200_OK)
        
    except Participant.DoesNotExist:
        return Response({'error': 'Invalid auth_token'}, status=status.HTTP_401_UNAUTHORIZED)


@api_view(['POST'])
@permission_classes([AllowAny])
def verify_code(request):
    """
    Verify the code and return JWT token for anonymous user.
    """
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
        
        # Create or get anonymous user for this participant
        anonymous_username = f"anonymous_participant_{participant.id}"
        user, created = User.objects.get_or_create(
            username=anonymous_username,
            defaults={
                'email': participant.email or '',
                'is_active': True,
                'first_name': 'Anonymous',
                'last_name': 'User'
            }
        )
        
        # Generate JWT token
        refresh = RefreshToken.for_user(user)
        
        # Clean up session data
        del request.session[f'verification_code_{participant_id}']
        del request.session['participant_id_pending']
        
        return Response({
            'access': str(refresh.access_token),
            'refresh': str(refresh),
            'participant_id': participant.id,
            'user_id': user.id
        }, status=status.HTTP_200_OK)
        
    except Participant.DoesNotExist:
        return Response({'error': 'Invalid participant'}, status=status.HTTP_400_BAD_REQUEST)
