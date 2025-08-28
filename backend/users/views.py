from rest_framework_simplejwt.tokens import RefreshToken
from django.shortcuts import render
from django.views.generic import View
from rest_framework import viewsets, status
from rest_framework.decorators import action
from rest_framework.response import Response
from rest_framework.permissions import IsAuthenticated
from django.contrib.auth import get_user_model
from drf_spectacular.utils import extend_schema
from .models import Speciality
from .serializers import SpecialitySerializer, UserDetailsSerializer
from consultations.serializers import ReasonSerializer
from itsdangerous import URLSafeTimedSerializer
from django.conf import settings
from rest_framework.views import APIView
from django.core.mail import send_mail
from drf_spectacular.utils import extend_schema, OpenApiParameter, OpenApiTypes, OpenApiExample
from consultations.models import Consultation
from consultations.serializers import ConsultationSerializer

User = get_user_model()

# Create your views here.

User = get_user_model()

class Home(View):
    template_name = 'useapp.html'
    
    def get(self, request, *args, **kwargs):
        return render(request, self.template_name)

class SpecialityViewSet(viewsets.ReadOnlyModelViewSet):
    """
    ViewSet for specialities - read only
    """
    queryset = Speciality.objects.all()
    serializer_class = SpecialitySerializer
    permission_classes = [IsAuthenticated]

    @extend_schema(responses=ReasonSerializer(many=True))
    @action(detail=True, methods=['get'])
    def reasons(self, request, pk=None):
        """Get active reasons for this specialty"""
        specialty = self.get_object()
        reasons = specialty.reasons.filter(is_active=True)
        serializer = ReasonSerializer(reasons, many=True)
        return Response(serializer.data)

    @extend_schema(responses=UserDetailsSerializer(many=True))
    @action(detail=True, methods=['get'])
    def doctors(self, request, pk=None):
        """Get doctors for this specialty"""
        specialty = self.get_object()
        doctors = User.objects.filter(specialities=specialty)
        serializer = UserDetailsSerializer(doctors, many=True)
        return Response(serializer.data)


def generate_magic_token(user):
    serializer = URLSafeTimedSerializer(settings.SECRET_KEY)
    return serializer.dumps({"user_id": user.id})


def verify_magic_token(token, max_age=900):  # 15 minutes
    serializer = URLSafeTimedSerializer(settings.SECRET_KEY)
    return serializer.loads(token, max_age=max_age)


class MagicLinkRequestView(APIView):
    @extend_schema(
        request={
            'application/json': {
                'type': 'object',
                'properties': {
                    'email': {
                        'type': 'string',
                        'format': 'email',
                        'example': 'user@example.com'
                    }
                },
                'required': ['email']
            }
        },
        responses={
            200: OpenApiExample(
                'Success',
                value={"detail": "Magic link sent."},
                response_only=True
            ),
            404: OpenApiExample(
                'User not found',
                value={"detail": "User not found."},
                response_only=True
            ),
        },
        examples=[
            OpenApiExample(
                'Request example',
                value={"email": "user@example.com"},
                request_only=True
            )
        ],
        description="Send magic link for user authentication."
    )
    def post(self, request):
        email = request.data.get("email")
        try:
            user = User.objects.get(email=email)
        except User.DoesNotExist:
            return Response({"detail": "User not found."}, status=status.HTTP_404_NOT_FOUND)

        token = generate_magic_token(user)
        link = f"{settings.PATIENT_URL}/magic-login?token={token}"

        send_mail(
            "Your login link",
            f"Click here to login: {link}",
            settings.DEFAULT_FROM_EMAIL,
            [user.email],
        )

        return Response({"detail": "Magic link sent."})


class MagicLinkVerifyView(APIView):
    @extend_schema(
        request={
            'application/json': {
                'type': 'object',
                'properties': {
                    'token': {
                        'type': 'string',
                        'example': 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...'
                    }
                },
                'required': ['token']
            }
        },
        responses={
            200: OpenApiExample(
                'Success',
                value={
                    "refresh": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
                    "access": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
                },
                response_only=True
            ),
            400: OpenApiExample(
                'Invalid token',
                value={"detail": "Invalid or expired link."},
                response_only=True
            ),
        },
        description="Verify magic link token and return JWT tokens."
    )
    def post(self, request):
        token = request.data.get("token")
        try:
            data = verify_magic_token(token)
            user = User.objects.get(id=data["user_id"])
        except Exception:
            return Response({"detail": "Invalid or expired link."}, status=status.HTTP_400_BAD_REQUEST)

        refresh = RefreshToken.for_user(user)
        return Response({
            "refresh": str(refresh),
            "access": str(refresh.access_token),
        })


class UserConsultationsView(APIView):
    permission_classes = [IsAuthenticated]
    
    @extend_schema(
        parameters=[
            OpenApiParameter(
                name="status",
                description="Filter consultations by status: 'open' for consultations without closed_at, 'closed' for consultations with closed_at",
                required=False,
                type=OpenApiTypes.STR,
                location=OpenApiParameter.QUERY,
                enum=['open', 'closed']
            ),
        ],
        responses={
            200: ConsultationSerializer(many=True),
        },
        examples=[
            OpenApiExample(
                'Get all consultations',
                description='Returns all consultations for the user',
                value=None,
                parameter_only=OpenApiParameter.QUERY
            ),
            OpenApiExample(
                'Get open consultations',
                description='Returns only open consultations (closed_at is null)',
                value='open',
                parameter_only=OpenApiParameter.QUERY
            ),
            OpenApiExample(
                'Get closed consultations',
                description='Returns only closed consultations (closed_at is not null)',
                value='closed',
                parameter_only=OpenApiParameter.QUERY
            ),
        ],
        description="Get all consultations where the authenticated user is the beneficiary. Filter by status: 'open' (closed_at is null) or 'closed' (closed_at is not null)."
    )
    def get(self, request):
        """Get all consultations for the authenticated user as patient/beneficiary."""
        consultations = Consultation.objects.filter(beneficiary=request.user)
        
        # Filter by status if provided
        status = request.query_params.get('status')
        if status == 'open':
            consultations = consultations.filter(closed_at__isnull=True)
        elif status == 'closed':
            consultations = consultations.filter(closed_at__isnull=False)
        
        consultations = consultations.order_by('-created_at')
        serializer = ConsultationSerializer(consultations, many=True)
        return Response(serializer.data)
