from rest_framework_simplejwt.tokens import RefreshToken
from django.shortcuts import render
from django.views.generic import View
from rest_framework import viewsets, status
from rest_framework.decorators import action
from rest_framework.response import Response
from rest_framework.permissions import IsAuthenticated
from rest_framework.pagination import PageNumberPagination
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
from messaging.models import Message
from messaging.serializers import MessageSerializer

User = get_user_model()

# Create your views here.

class ConsultationPagination(PageNumberPagination):
    page_size = 20
    page_size_query_param = 'page_size'
    max_page_size = 100

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
    pagination_class = ConsultationPagination
    
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
            OpenApiParameter(
                name="page",
                description="Page number for pagination",
                required=False,
                type=OpenApiTypes.INT,
                location=OpenApiParameter.QUERY,
            ),
            OpenApiParameter(
                name="page_size",
                description="Number of results per page (max 100)",
                required=False,
                type=OpenApiTypes.INT,
                location=OpenApiParameter.QUERY,
            ),
        ],
        responses={
            200: {
                'type': 'object',
                'properties': {
                    'count': {'type': 'integer'},
                    'next': {'type': 'string', 'nullable': True},
                    'previous': {'type': 'string', 'nullable': True},
                    'results': {
                        'type': 'array',
                        'items': ConsultationSerializer().to_representation({})
                    }
                }
            },
        },
        examples=[
            OpenApiExample(
                'Get paginated consultations',
                description='Returns paginated consultations for the user',
                value={
                    "count": 45,
                    "next": "http://localhost:8000/api/auth/user/consultations/?page=3",
                    "previous": "http://localhost:8000/api/auth/user/consultations/?page=1",
                    "results": [
                        {
                            "id": 1,
                            "title": "Consultation example",
                            "description": "Sample consultation",
                            "created_at": "2025-01-15T10:30:00Z",
                            "closed_at": None
                        }
                    ]
                },
                response_only=True
            ),
        ],
        description="Get paginated consultations where the authenticated user is the beneficiary. Filter by status: 'open' (closed_at is null) or 'closed' (closed_at is not null). Default page size is 20, max 100."
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
        
        # Apply pagination
        paginator = self.pagination_class()
        paginated_consultations = paginator.paginate_queryset(consultations, request)
        serializer = ConsultationSerializer(paginated_consultations, many=True)
        return paginator.get_paginated_response(serializer.data)


class NotificationsPagination(PageNumberPagination):
    page_size = 20
    page_size_query_param = 'page_size'
    max_page_size = 100


class UserNotificationsView(APIView):
    permission_classes = [IsAuthenticated]
    pagination_class = NotificationsPagination
    
    @extend_schema(
        parameters=[
            OpenApiParameter(
                name="status",
                description="Filter notifications by status: 'read', 'delivered', 'sent', 'pending', 'failed'",
                required=False,
                type=OpenApiTypes.STR,
                location=OpenApiParameter.QUERY,
                enum=['read', 'delivered', 'sent', 'pending', 'failed']
            ),
            OpenApiParameter(
                name="page",
                description="Page number for pagination",
                required=False,
                type=OpenApiTypes.INT,
                location=OpenApiParameter.QUERY,
            ),
            OpenApiParameter(
                name="page_size",
                description="Number of results per page (max 100)",
                required=False,
                type=OpenApiTypes.INT,
                location=OpenApiParameter.QUERY,
            ),
        ],
        responses={
            200: MessageSerializer(many=True),
        },
        examples=[
            OpenApiExample(
                'Get paginated notifications',
                description='Returns paginated notifications for the user',
                value={
                    "count": 25,
                    "next": "http://localhost:8000/api/auth/user/notifications/?page=2",
                    "previous": None,
                    "results": [
                        {
                            "id": 1,
                            "subject": "Consultation reminder",
                            "content": "Your consultation is scheduled for tomorrow",
                            "communication_method": "email",
                            "status": "delivered",
                            "sent_at": "2025-01-15T10:30:00Z",
                            "created_at": "2025-01-15T10:29:00Z"
                        }
                    ]
                },
                response_only=True
            ),
        ],
        description="Get paginated notifications (messages) where the authenticated user is the recipient. Filter by message status. Default page size is 20, max 100."
    )
    def get(self, request):
        """Get all notifications for the authenticated user as recipient."""
        notifications = Message.objects.filter(sent_to=request.user)
        
        # Filter by status if provided
        status = request.query_params.get('status')
        if status:
            notifications = notifications.filter(status=status)
        
        notifications = notifications.order_by('-created_at')
        
        # Apply pagination
        paginator = self.pagination_class()
        paginated_notifications = paginator.paginate_queryset(notifications, request)
        serializer = MessageSerializer(paginated_notifications, many=True)
        return paginator.get_paginated_response(serializer.data)
