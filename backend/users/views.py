from rest_framework_simplejwt.tokens import RefreshToken
from django.shortcuts import render
from django.views.generic import View
from rest_framework import viewsets, status
from rest_framework.decorators import action
from rest_framework.response import Response
from rest_framework.permissions import IsAuthenticated, DjangoModelPermissions, BasePermission
from rest_framework.pagination import PageNumberPagination
from rest_framework import filters
from django.contrib.auth import get_user_model
from drf_spectacular.utils import extend_schema
from .models import Speciality, Language
from .serializers import SpecialitySerializer, UserDetailsSerializer, LanguageSerializer, OrganisationSerializer
from consultations.serializers import ReasonSerializer, AppointmentDetailSerializer
from itsdangerous import URLSafeTimedSerializer
from django.conf import settings
from rest_framework.views import APIView
from django.core.mail import send_mail
from drf_spectacular.utils import extend_schema, OpenApiParameter, OpenApiTypes, OpenApiExample
from consultations.models import Consultation, Appointment, Participant, Message as ConsultationMessage
from consultations.serializers import ConsultationSerializer, AppointmentSerializer, ConsultationMessageSerializer
from messaging.models import Message
from messaging.serializers import MessageSerializer
from .models import HealthMetric
from .serializers import HealthMetricSerializer
from allauth.socialaccount.providers.oauth2.client import OAuth2Client
from dj_rest_auth.registration.views import SocialLoginView
from dj_rest_auth.registration.serializers import SocialLoginSerializer
from allauth.socialaccount.providers.openid_connect.views import OpenIDConnectOAuth2Adapter
from rest_framework_simplejwt.authentication import JWTAuthentication
from mediaserver.models import Server

User = get_user_model()

class DjangoModelPermissionsWithView(DjangoModelPermissions):
    """
    Custom permission class that includes view permissions.
    """
    perms_map = {
        'GET': ['%(app_label)s.view_%(model_name)s'],
        'OPTIONS': [],
        'HEAD': [],
        'POST': ['%(app_label)s.add_%(model_name)s'],
        'PUT': ['%(app_label)s.change_%(model_name)s'],
        'PATCH': ['%(app_label)s.change_%(model_name)s'],
        'DELETE': ['%(app_label)s.delete_%(model_name)s'],
    }

# Create your views here.

class UniversalPagination(PageNumberPagination):
    page_size = 20
    page_size_query_param = 'page_size'
    max_page_size = 100

User = get_user_model()

class Home(View):
    template_name = 'useapp.html'
    
    def get(self, request, *args, **kwargs):
        return render(request, self.template_name)

class LanguageViewSet(viewsets.ReadOnlyModelViewSet):
    """
    ViewSet for languages - read only
    """
    queryset = Language.objects.all()
    serializer_class = LanguageSerializer
    permission_classes = [IsAuthenticated]

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

    @extend_schema(responses=OrganisationSerializer(many=True))
    @action(detail=True, methods=['get'])
    def organisations(self, request, pk=None):
        """Get organisations based on users with this specialty"""
        specialty = self.get_object()
        # Get users with this specialty who have a main_organisation
        users_with_specialty = User.objects.filter(
            specialities=specialty,
            main_organisation__isnull=False
        ).select_related('main_organisation')
        
        # Extract unique organizations
        organisations = []
        seen_org_ids = set()
        for user in users_with_specialty:
            if user.main_organisation.id not in seen_org_ids:
                organisations.append(user.main_organisation)
                seen_org_ids.add(user.main_organisation.id)
        
        serializer = OrganisationSerializer(organisations, many=True)
        return Response(serializer.data)


def generate_magic_token(user):
    serializer = URLSafeTimedSerializer(settings.SECRET_KEY)
    return serializer.dumps({"user_id": user.id})


def verify_magic_token(token, max_age=900):  # 15 minutes
    serializer = URLSafeTimedSerializer(settings.SECRET_KEY)
    return serializer.loads(token, max_age=max_age)


class UserConsultationsViewSet(viewsets.ReadOnlyModelViewSet):
    authentication_classes = [JWTAuthentication]
    permission_classes = [IsAuthenticated]
    pagination_class = UniversalPagination
    serializer_class = ConsultationSerializer

    def get_queryset(self):
        """Get consultations for the authenticated user."""
        user = self.request.user

        # For regular users, get consultations where they are the beneficiary
        consultations = Consultation.objects.filter(beneficiary=user)

        # Filter by status if provided
        status = self.request.query_params.get('status')
        if status == 'open':
            consultations = consultations.filter(closed_at__isnull=True)
        elif status == 'closed':
            consultations = consultations.filter(closed_at__isnull=False)

        return consultations.order_by('-created_at')

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
        description="Get paginated consultations where the authenticated user is the beneficiary or participant."
    )
    def list(self, request, *args, **kwargs):
        """List all consultations for the authenticated user."""
        return super().list(request, *args, **kwargs)

    @extend_schema(
        responses={
            200: ConsultationSerializer,
            404: {
                'type': 'object',
                'properties': {
                    'detail': {'type': 'string'}
                },
                'example': {"detail": "Not found."}
            }
        },
        description="Get a specific consultation by ID."
    )
    def retrieve(self, request, *args, **kwargs):
        """Get a specific consultation by ID."""
        return super().retrieve(request, *args, **kwargs)

    @extend_schema(
        request=ConsultationMessageSerializer,
        responses={
            200: ConsultationMessageSerializer(many=True),
            201: ConsultationMessageSerializer,
            404: {
                'type': 'object',
                'properties': {
                    'detail': {'type': 'string'}
                },
                'example': {"detail": "Consultation not found."}
            }
        },
        description="Get messages for this consultation (paginated) or create a new message."
    )
    @action(detail=True, methods=['get', 'post'])
    def messages(self, request, pk=None):
        """Get messages for this consultation or create a new message."""
        consultation = self.get_object()

        if request.method == 'GET':
            messages = consultation.messages.all().order_by('-created_at')

            # Apply pagination
            page = self.paginate_queryset(messages)
            if page is not None:
                serializer = ConsultationMessageSerializer(page, many=True)
                return self.get_paginated_response(serializer.data)

            serializer = ConsultationMessageSerializer(messages, many=True)
            return Response(serializer.data)

        elif request.method == 'POST':
            serializer = ConsultationMessageSerializer(
                data=request.data,
                context={'request': request}
            )

            if serializer.is_valid():
                message = serializer.save(consultation=consultation)
                return Response(
                    ConsultationMessageSerializer(message).data,
                    status=status.HTTP_201_CREATED
                )

            return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

    @extend_schema(
        request=ConsultationMessageSerializer,
        responses={
            200: ConsultationMessageSerializer,
            404: {
                'type': 'object',
                'properties': {
                    'detail': {'type': 'string'}
                },
                'example': {"detail": "Message not found."}
            }
        },
        parameters=[
            OpenApiParameter(
                name='message_id',
                type=OpenApiTypes.INT,
                location=OpenApiParameter.PATH,
                description='ID of the message to update'
            )
        ],
        description="Update a specific message in this consultation."
    )
    @action(detail=True, methods=['patch'], url_path='messages/(?P<message_id>[^/.]+)')
    def update_message(self, request, pk=None, message_id=None):
        """Update a specific message in this consultation."""
        consultation = self.get_object()

        try:
            message = consultation.messages.get(id=message_id, created_by=request.user)
        except ConsultationMessage.DoesNotExist:
            return Response(
                {"detail": "Message not found or you don't have permission to update it."},
                status=status.HTTP_404_NOT_FOUND
            )

        serializer = ConsultationMessageSerializer(
            message,
            data=request.data,
            partial=True,
            context={'request': request}
        )

        if serializer.is_valid():
            serializer.save()
            return Response(serializer.data)

        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)


class MessageAttachmentView(APIView):
    authentication_classes = [JWTAuthentication]
    permission_classes = [IsAuthenticated]

    @extend_schema(
        responses={
            200: {
                'type': 'object',
                'properties': {
                    'attachment': {'type': 'string', 'format': 'uri'}
                },
                'example': {"attachment": "/media/messages_attachment/file.pdf"}
            },
            404: {
                'type': 'object',
                'properties': {
                    'detail': {'type': 'string'}
                },
                'example': {"detail": "Message not found or no attachment."}
            },
            403: {
                'type': 'object',
                'properties': {
                    'detail': {'type': 'string'}
                },
                'example': {"detail": "You don't have permission to access this message."}
            }
        },
        description="Get attachment for a specific message. User must have access to the consultation containing the message."
    )
    def get(self, request, message_id):
        """Get attachment for a specific message if user has permission."""
        try:
            message = ConsultationMessage.objects.select_related('consultation').get(id=message_id)
        except ConsultationMessage.DoesNotExist:
            return Response(
                {"detail": "Message not found."},
                status=status.HTTP_404_NOT_FOUND
            )

        # Check if user has permission to access this consultation
        consultation = message.consultation
        user = request.user

        # Check if user is related to the consultation (same logic as UserConsultationsViewSet)
        if consultation.beneficiary != user:
            return Response(
                {"detail": "You don't have permission to access this message."},
                status=status.HTTP_403_FORBIDDEN
            )

        # Check if message has an attachment
        if not message.attachment:
            return Response(
                {"detail": "Message has no attachment."},
                status=status.HTTP_404_NOT_FOUND
            )

        # Return the attachment URL
        return Response({
            'attachment': message.attachment.url if message.attachment else None
        })


class UserNotificationsView(APIView):
    permission_classes = [IsAuthenticated]
    pagination_class = UniversalPagination
    
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
                    "next": "http://localhost:8000/api/user/notifications/?page=2",
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


class UserAppointmentsView(APIView):
    authentication_classes = [JWTAuthentication]
    permission_classes = [IsAuthenticated]
    pagination_class = UniversalPagination
    
    @extend_schema(
        parameters=[
            OpenApiParameter(
                name="status",
                description="Filter appointments by status: 'Scheduled' or 'Cancelled'",
                required=False,
                type=OpenApiTypes.STR,
                location=OpenApiParameter.QUERY,
                enum=['Scheduled', 'Cancelled']
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
            200: AppointmentSerializer(many=True),
        },
        examples=[
            OpenApiExample(
                'Get paginated appointments',
                description='Returns paginated appointments where user is a participant',
                value={
                    "count": 15,
                    "next": "http://localhost:8000/api/user/appointments/?page=2",
                    "previous": None,
                    "results": [
                        {
                            "id": 1,
                            "scheduled_at": "2025-01-16T10:00:00Z",
                            "end_expected_at": "2025-01-16T10:30:00Z",
                            "status": "Scheduled",
                            "created_at": "2025-01-15T08:00:00Z"
                        }
                    ]
                },
                response_only=True
            ),
        ],
        description="Get paginated appointments where the authenticated user is a participant. Filter by appointment status. Default page size is 20, max 100."
    )
    def get(self, request):

        """Get all appointments where the authenticated user is a participant."""
        # Get appointments where user is a participant
        appointments = Appointment.objects.filter(
            participant__user=request.user
        ).distinct()
        
        # Filter by status if provided
        status = request.query_params.get('status')
        if status:
            appointments = appointments.filter(status=status)
        
        appointments = appointments.order_by('-scheduled_at')
        
        # Apply pagination
        paginator = self.pagination_class()
        paginated_appointments = paginator.paginate_queryset(appointments, request)
        serializer = AppointmentSerializer(paginated_appointments, many=True)
        return paginator.get_paginated_response(serializer.data)


class UserHealthMetricsView(APIView):
    permission_classes = [IsAuthenticated]
    pagination_class = UniversalPagination
    
    @extend_schema(
        parameters=[
            OpenApiParameter(
                name="from_date",
                description="Filter health metrics from this date (format: YYYY-MM-DD)",
                required=False,
                type=OpenApiTypes.DATE,
                location=OpenApiParameter.QUERY,
            ),
            OpenApiParameter(
                name="to_date", 
                description="Filter health metrics up to this date (format: YYYY-MM-DD)",
                required=False,
                type=OpenApiTypes.DATE,
                location=OpenApiParameter.QUERY,
            ),
            OpenApiParameter(
                name="source",
                description="Filter by measurement source (e.g., 'manual', 'device', 'EHR')",
                required=False,
                type=OpenApiTypes.STR,
                location=OpenApiParameter.QUERY,
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
            200: HealthMetricSerializer(many=True),
        },
        examples=[
            OpenApiExample(
                'Get paginated health metrics',
                description='Returns paginated health metrics for the authenticated user',
                value={
                    "count": 25,
                    "next": "http://localhost:8000/api/user/healthmetrics/?page=2",
                    "previous": None,
                    "results": [
                        {
                            "id": 1,
                            "measured_at": "2025-01-15T10:30:00Z",
                            "systolic_bp": 120,
                            "diastolic_bp": 80,
                            "heart_rate_bpm": 72,
                            "temperature_c": "36.5",
                            "source": "manual",
                            "notes": "Regular checkup",
                            "created_at": "2025-01-15T10:35:00Z"
                        }
                    ]
                },
                response_only=True
            ),
        ],
        description="Get paginated health metrics for the authenticated user. Filter by date range and source. All health metrics fields are included in the response. Default page size is 20, max 100."
    )
    def get(self, request):
        """Get all health metrics for the authenticated user."""
        health_metrics = HealthMetric.objects.filter(user=request.user)
        
        # Filter by date range
        from_date = request.query_params.get('from_date')
        if from_date:
            try:
                from datetime import datetime
                from_date_obj = datetime.strptime(from_date, '%Y-%m-%d').date()
                health_metrics = health_metrics.filter(measured_at__date__gte=from_date_obj)
            except ValueError:
                return Response({"error": "Invalid from_date format. Use YYYY-MM-DD"}, status=status.HTTP_400_BAD_REQUEST)
        
        to_date = request.query_params.get('to_date')
        if to_date:
            try:
                from datetime import datetime
                to_date_obj = datetime.strptime(to_date, '%Y-%m-%d').date()
                health_metrics = health_metrics.filter(measured_at__date__lte=to_date_obj)
            except ValueError:
                return Response({"error": "Invalid to_date format. Use YYYY-MM-DD"}, status=status.HTTP_400_BAD_REQUEST)
        
        # Filter by source
        source = request.query_params.get('source')
        if source:
            health_metrics = health_metrics.filter(source__icontains=source)
        
        health_metrics = health_metrics.order_by('-measured_at')
        
        # Apply pagination
        paginator = self.pagination_class()
        paginated_health_metrics = paginator.paginate_queryset(health_metrics, request)
        serializer = HealthMetricSerializer(paginated_health_metrics, many=True)
        return paginator.get_paginated_response(serializer.data)


class UserViewSet(viewsets.ModelViewSet):
    """
    ViewSet for users - read only with GET endpoint
    Supports search by first name, last name, and email
    """
    queryset = User.objects.all()
    serializer_class = UserDetailsSerializer
    permission_classes = [IsAuthenticated, DjangoModelPermissionsWithView]
    pagination_class = UniversalPagination
    filter_backends = [filters.SearchFilter]
    search_fields = ['first_name', 'last_name', 'email']

    def update(self, request, *args, **kwargs):
        """Prevent updating users with superuser or staff access."""
        user = self.get_object()

        # Prevent updating superusers and staff users
        if user.is_superuser or user.is_staff:
            return Response(
                {"detail": "Cannot update users with portal or super admin access."},
                status=status.HTTP_403_FORBIDDEN
            )

        return super().update(request, *args, **kwargs)

    def partial_update(self, request, *args, **kwargs):
        """Prevent partially updating users with superuser or staff access."""
        user = self.get_object()

        # Prevent updating superusers and staff users
        if user.is_superuser or user.is_staff:
            return Response(
                {"detail": "Cannot update users with portal or super admin access."},
                status=status.HTTP_403_FORBIDDEN
            )

        return super().partial_update(request, *args, **kwargs)
    
    @extend_schema(responses=HealthMetricSerializer(many=True))
    @action(detail=True, methods=['get'])
    def healthmetric(self, request, pk=None):
        """Get health metrics for this user"""
        user = self.get_object()
        health_metrics = HealthMetric.objects.filter(user=user).order_by('-measured_at')

        page = self.paginate_queryset(health_metrics)
        if page is not None:
            serializer = HealthMetricSerializer(page, many=True)
            return self.get_paginated_response(serializer.data)

        serializer = HealthMetricSerializer(health_metrics, many=True)
        return Response(serializer.data)

    @extend_schema(responses=SpecialitySerializer(many=True))
    @action(detail=True, methods=['get'])
    def specialities(self, request, pk=None):
        """Get specialities for this user"""
        user = self.get_object()
        specialities = user.specialities.all()
        serializer = SpecialitySerializer(specialities, many=True)
        return Response(serializer.data)

class OpenIDView(SocialLoginView):
    adapter_class = OpenIDConnectOAuth2Adapter
    serializer_class = SocialLoginSerializer
    client_class = OAuth2Client


class UserAppointmentViewSet(viewsets.ReadOnlyModelViewSet):
    permission_classes = [IsAuthenticated]
    serializer_class = AppointmentDetailSerializer

    def get_queryset(self):
        """Get appointments where the user is a participant."""
        return Appointment.objects.select_related(
            'consultation__created_by',
            'consultation__owned_by',
            'consultation__beneficiary',
            'consultation__group',
            'created_by'
        ).prefetch_related(
            'participant_set__user',
            'consultation__group__users'
        ).filter(
            participant__user=self.request.user
        ).distinct()

    @extend_schema(
        request={
            'application/json': {
                'type': 'object',
                'properties': {
                    'is_present': {
                        'type': 'boolean',
                        'example': True
                    }
                },
                'required': ['is_present']
            }
        },
        responses={
            200: {
                'type': 'object',
                'properties': {
                    'detail': {'type': 'string'},
                    'is_confirmed': {'type': 'boolean'}
                },
                'example': {"detail": "Presence updated successfully.", "is_confirmed": True}
            },
            400: {
                'type': 'object',
                'properties': {
                    'detail': {'type': 'string'}
                },
                'example': {"detail": "is_present parameter is required."}
            },
            404: {
                'type': 'object',
                'properties': {
                    'detail': {'type': 'string'}
                },
                'example': {"detail": "Appointment not found or you are not a participant."}
            }
        },
        description="Update the presence (is_confirmed) of the authenticated user in the appointment."
    )
    @action(detail=True, methods=['post'])
    def presence(self, request, pk=None):
        """Update participant presence (is_confirmed field)."""
        is_present = request.data.get('is_present')

        if is_present is None:
            return Response(
                {"detail": "is_present parameter is required."},
                status=status.HTTP_400_BAD_REQUEST
            )

        appointment = self.get_object()

        try:
            participant = Participant.objects.get(
                appointment=appointment,
                user=request.user
            )
            participant.is_confirmed = bool(is_present)
            participant.save()

            return Response({
                "detail": "Presence updated successfully.",
                "is_confirmed": participant.is_confirmed
            })

        except Participant.DoesNotExist:
            return Response(
                {"detail": "You are not a participant in this appointment."},
                status=status.HTTP_404_NOT_FOUND
            )

    @extend_schema(
        responses={
            200: {
                'type': 'object',
                'properties': {
                    'url': {'type': 'string', 'description': 'Media server URL'},
                    'token': {'type': 'string', 'description': 'JWT token for RTC connection'},
                    'room': {'type': 'string', 'description': 'Test room name'}
                },
                'example': {
                    "url": "wss://livekit.example.com",
                    "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
                    "room": "usertest_123"
                }
            },
            500: {
                'type': 'object',
                'properties': {
                    'detail': {'type': 'string'}
                },
                'example': {"detail": "No media server available."}
            }
        },
        description="Get RTC test connection information for the authenticated user. Returns server URL, JWT token, and room name for testing WebRTC connection."
    )
    @action(detail=True, methods=['get'])
    def join(self, request, pk=None):
        """Join consultation call"""
        appointment = self.get_object()
        if appointment.consultation.closed_at:
            return Response(
                {'error': 'Cannot join call in closed consultation'},
                status=status.HTTP_400_BAD_REQUEST
            )

        try:
            server = Server.get_server()

            consultation_call_info = server.instance.appointment_participant_info(
                appointment, request.user)

            return Response({
                'url': server.url,
                'token': consultation_call_info,
                'room': f"appointment_{appointment.pk}"
            })
        except Exception as e:
            return Response(
                {"detail": "No media server available."},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR
            )


class TestRTCView(APIView):
    authentication_classes = [JWTAuthentication]
    permission_classes = [IsAuthenticated]

    @extend_schema(
        responses={
            200: {
                'type': 'object',
                'properties': {
                    'url': {'type': 'string', 'description': 'Media server URL'},
                    'token': {'type': 'string', 'description': 'JWT token for RTC connection'},
                    'room': {'type': 'string', 'description': 'Test room name'}
                },
                'example': {
                    "url": "wss://livekit.example.com",
                    "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
                    "room": "usertest_123"
                }
            },
            500: {
                'type': 'object',
                'properties': {
                    'detail': {'type': 'string'}
                },
                'example': {"detail": "No media server available."}
            }
        },
        description="Get RTC test connection information for the authenticated user. Returns server URL, JWT token, and room name for testing WebRTC connection."
    )
    def get(self, request):
        """Get RTC test information for the authenticated user."""
        try:
            server = Server.get_server()
            
            test_info = server.instance.user_test_info(request.user)

            return Response({
                'url': server.url,
                'token': test_info,
                'room': f"usertest_{request.user.pk}"
            })
        except Exception as e:
            return Response(
                {"detail": "No media server available."},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR
            )
