import logging
import mimetypes

logger = logging.getLogger(__name__)
import os
import random
import uuid
import secrets

import uuid

from django.utils.translation import gettext as _
from allauth.socialaccount.providers.oauth2.client import OAuth2Client
from allauth.socialaccount.providers.openid_connect.views import (
    OpenIDConnectOAuth2Adapter,
)
from asgiref.sync import async_to_sync
from channels.layers import get_channel_layer
from consultations.models import (
    Appointment,
    Consultation,
    Participant,
    Reason,
    Request,
    RequestStatus,
)
from consultations.models import Message as ConsultationMessage
from consultations.permissions import IsPractitioner
from consultations.serializers import (
    AppointmentDetailSerializer,
    AppointmentSerializer,
    ConsultationMessageCreateSerializer,
    ConsultationMessageSerializer,
    ConsultationSerializer,
    ReasonSerializer,
    RequestSerializer,
)
from dj_rest_auth.registration.serializers import SocialLoginSerializer
from dj_rest_auth.registration.views import RegisterView as DjRestAuthRegisterView
from dj_rest_auth.registration.views import SocialLoginView
from dj_rest_auth.views import LoginView as DjRestAuthLoginView
from dj_rest_auth.views import PasswordChangeView as DjRestAuthPasswordChangeView
from dj_rest_auth.views import PasswordResetView as DjRestAuthPasswordResetView
from dj_rest_auth.views import PasswordResetConfirmView as DjRestAuthPasswordResetConfirmView
from django.conf import settings
from django.contrib.auth import get_user_model
from django.contrib.contenttypes.models import ContentType
from django.db.models import Q
from django.http import FileResponse
from django.shortcuts import render
from django.utils import timezone, translation
from django.views.generic import View
from django_filters.rest_framework import DjangoFilterBackend
from drf_spectacular.utils import (
    OpenApiExample,
    OpenApiParameter,
    OpenApiTypes,
    extend_schema,
)
from itsdangerous import URLSafeTimedSerializer
from mediaserver.models import Server
from messaging.models import Message
from messaging.serializers import MessageSerializer
from rest_framework import filters, status, viewsets
from rest_framework.decorators import action
from rest_framework.pagination import PageNumberPagination
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework_simplejwt.authentication import JWTAuthentication
from constance import config as constance_config
from allauth.socialaccount.models import SocialApp

from .filters import UserFilter
from .models import HealthMetric, Language, Organisation, Speciality, Term, User, WebPushSubscription
from .serializers import (
    HealthMetricSerializer,
    LanguageSerializer,
    OrganisationSerializer,
    SpecialitySerializer,
    TermSerializer,
    UserDetailsSerializer,
    UserParticipantDetailSerializer,
    WebPushSubscriptionSerializer,
)
from constance import config

class UniversalPagination(PageNumberPagination):
    page_size = 20
    page_size_query_param = "page_size"
    max_page_size = 100


User = get_user_model()


class Home(View):
    template_name = "useapp.html"

    def get(self, request, *args, **kwargs):
        return render(request, self.template_name)


class LanguageViewSet(viewsets.ReadOnlyModelViewSet):
    """
    ViewSet for languages - read only
    """

    queryset = Language.objects.all()
    serializer_class = LanguageSerializer
    permission_classes = [IsAuthenticated]


class TermViewSet(viewsets.ReadOnlyModelViewSet):
    """
    ViewSet for terms - read only
    """

    queryset = Term.objects.all()
    serializer_class = TermSerializer
    permission_classes = [IsAuthenticated]


class SpecialityViewSet(viewsets.ReadOnlyModelViewSet):
    """
    ViewSet for specialities - read only.
    Public access when public_organisations is enabled.
    """

    queryset = Speciality.objects.all()
    serializer_class = SpecialitySerializer
    filter_backends = [DjangoFilterBackend]
    filterset_fields = []

    def get_permissions(self):
        if constance_config.public_organisations:
            return [AllowAny()]
        return [IsAuthenticated()]

    @extend_schema(
        parameters=[
            OpenApiParameter(
                name="organisation",
                description="Filter specialities by organisation ID (returns specialities that have at least one practitioner in this organisation)",
                required=False,
                type=int,
                location=OpenApiParameter.QUERY,
            ),
        ]
    )
    def list(self, request, *args, **kwargs):
        return super().list(request, *args, **kwargs)

    def get_queryset(self):
        qs = super().get_queryset()
        organisation = self.request.query_params.get("organisation")
        if organisation:
            qs = qs.filter(user__main_organisation_id=organisation).distinct()
        return qs

    @extend_schema(responses=ReasonSerializer(many=True))
    @action(detail=True, methods=["get"])
    def reasons(self, request, pk=None):
        """Get active reasons for this specialty"""
        specialty = self.get_object()
        reasons = specialty.reasons.filter(is_active=True)
        serializer = ReasonSerializer(reasons, many=True)
        return Response(serializer.data)

    @extend_schema(
        responses=UserDetailsSerializer(many=True),
        parameters=[
            OpenApiParameter(
                name="lat_min", description="Bounding box south latitude",
                required=False, type=float, location=OpenApiParameter.QUERY,
            ),
            OpenApiParameter(
                name="lat_max", description="Bounding box north latitude",
                required=False, type=float, location=OpenApiParameter.QUERY,
            ),
            OpenApiParameter(
                name="lng_min", description="Bounding box west longitude",
                required=False, type=float, location=OpenApiParameter.QUERY,
            ),
            OpenApiParameter(
                name="lng_max", description="Bounding box east longitude",
                required=False, type=float, location=OpenApiParameter.QUERY,
            ),
        ],
    )
    @action(detail=True, methods=["get"])
    def doctors(self, request, pk=None):
        """Get doctors for this specialty"""
        specialty = self.get_object()
        doctors = User.objects.filter(
            specialities=specialty, main_organisation__isnull=False
        ).select_related("main_organisation")
        doctors = self._filter_by_bounding_box(
            doctors, request, location_field="main_organisation__location"
        )
        serializer = UserDetailsSerializer(doctors, many=True)
        return Response(serializer.data)

    @extend_schema(
        responses=OrganisationSerializer(many=True),
        parameters=[
            OpenApiParameter(
                name="lat_min", description="Bounding box south latitude",
                required=False, type=float, location=OpenApiParameter.QUERY,
            ),
            OpenApiParameter(
                name="lat_max", description="Bounding box north latitude",
                required=False, type=float, location=OpenApiParameter.QUERY,
            ),
            OpenApiParameter(
                name="lng_min", description="Bounding box west longitude",
                required=False, type=float, location=OpenApiParameter.QUERY,
            ),
            OpenApiParameter(
                name="lng_max", description="Bounding box east longitude",
                required=False, type=float, location=OpenApiParameter.QUERY,
            ),
        ],
    )
    @action(detail=True, methods=["get"])
    def organisations(self, request, pk=None):
        """Get organisations based on users with this specialty"""
        specialty = self.get_object()
        users_with_specialty = User.objects.filter(
            specialities=specialty, main_organisation__isnull=False
        ).select_related("main_organisation")

        # Extract unique organizations
        organisations = []
        seen_org_ids = set()
        for user in users_with_specialty:
            if user.main_organisation.id not in seen_org_ids:
                organisations.append(user.main_organisation)
                seen_org_ids.add(user.main_organisation.id)

        # Apply bounding box filter
        organisations = self._filter_orgs_by_bounding_box(organisations, request)

        serializer = OrganisationSerializer(organisations, many=True)
        return Response(serializer.data)

    @staticmethod
    def _parse_bounding_box(request):
        lat_min = request.query_params.get("lat_min")
        lat_max = request.query_params.get("lat_max")
        lng_min = request.query_params.get("lng_min")
        lng_max = request.query_params.get("lng_max")
        if not all(v is not None for v in (lat_min, lat_max, lng_min, lng_max)):
            return None
        try:
            return float(lat_min), float(lat_max), float(lng_min), float(lng_max)
        except (ValueError, TypeError):
            return None

    @staticmethod
    def _location_in_bounds(location, bounds):
        if not location:
            return False
        try:
            lat, lng = (float(x) for x in location.split(","))
            return bounds[0] <= lat <= bounds[1] and bounds[2] <= lng <= bounds[3]
        except (ValueError, AttributeError):
            return False

    def _filter_by_bounding_box(self, queryset, request, location_field):
        bounds = self._parse_bounding_box(request)
        if not bounds:
            return queryset
        queryset = queryset.exclude(**{f"{location_field}__isnull": True}).exclude(
            **{location_field: ""}
        )
        ids = []
        for obj in queryset:
            loc = obj
            for attr in location_field.split("__"):
                loc = getattr(loc, attr, None)
                if loc is None:
                    break
            if self._location_in_bounds(loc, bounds):
                ids.append(obj.id)
        return queryset.filter(id__in=ids)

    def _filter_orgs_by_bounding_box(self, organisations, request):
        bounds = self._parse_bounding_box(request)
        if not bounds:
            return organisations
        return [
            org for org in organisations
            if self._location_in_bounds(org.location, bounds)
        ]


class OrganisationViewSet(viewsets.ReadOnlyModelViewSet):
    """
    ViewSet for organisations - read only.
    Access can be public or authenticated depending on the
    public_organisations setting.
    Supports bounding box filtering (lat_min, lat_max, lng_min, lng_max)
    and search query parameter.
    """

    queryset = Organisation.objects.all()
    serializer_class = OrganisationSerializer
    pagination_class = UniversalPagination

    def get_permissions(self):
        if constance_config.public_organisations:
            return [AllowAny()]
        return [IsAuthenticated()]

    def get_queryset(self):
        qs = super().get_queryset().exclude(
            location__isnull=True
        ).exclude(location="")
        search = self.request.query_params.get("search")
        if search:
            qs = qs.filter(
                Q(name__icontains=search)
                | Q(city__icontains=search)
                | Q(street__icontains=search)
                | Q(postal_code__icontains=search)
                | Q(country__icontains=search)
            )
        return qs

    def list(self, request, *args, **kwargs):
        queryset = self.filter_queryset(self.get_queryset())

        # Apply bounding box filter if provided and no search
        if not request.query_params.get("search"):
            queryset = self._filter_by_bounding_box(queryset, request)

        page = self.paginate_queryset(queryset)
        if page is not None:
            serializer = self.get_serializer(page, many=True)
            return self.get_paginated_response(serializer.data)
        serializer = self.get_serializer(queryset, many=True)
        return Response(serializer.data)

    @staticmethod
    def _filter_by_bounding_box(queryset, request):
        lat_min = request.query_params.get("lat_min")
        lat_max = request.query_params.get("lat_max")
        lng_min = request.query_params.get("lng_min")
        lng_max = request.query_params.get("lng_max")
        if not all(v is not None for v in (lat_min, lat_max, lng_min, lng_max)):
            return queryset
        try:
            bounds = float(lat_min), float(lat_max), float(lng_min), float(lng_max)
        except (ValueError, TypeError):
            return queryset
        queryset = queryset.exclude(location__isnull=True).exclude(location="")
        ids = []
        for obj in queryset:
            if not obj.location:
                continue
            try:
                lat, lng = (float(x) for x in obj.location.split(","))
                if bounds[0] <= lat <= bounds[1] and bounds[2] <= lng <= bounds[3]:
                    ids.append(obj.id)
            except (ValueError, AttributeError):
                continue
        return queryset.model.objects.filter(id__in=ids)


def generate_magic_token(user):
    serializer = URLSafeTimedSerializer(settings.SECRET_KEY)
    return serializer.dumps({"user_id": user.id})


def verify_magic_token(token, max_age=900):  # 15 minutes
    serializer = URLSafeTimedSerializer(settings.SECRET_KEY)
    return serializer.loads(token, max_age=max_age)


class UserParticipantViewSet(viewsets.ModelViewSet):
    permission_classes = [IsAuthenticated]
    pagination_class = UniversalPagination
    serializer_class = UserParticipantDetailSerializer
    http_method_names = ["get", "patch", "head", "options"]

    def get_queryset(self):
        user = self.request.user
        return Participant.objects.filter(user=user, is_active=True)


class UserConsultationsViewSet(viewsets.ReadOnlyModelViewSet):
    authentication_classes = [JWTAuthentication]
    permission_classes = [IsAuthenticated]
    pagination_class = UniversalPagination
    serializer_class = ConsultationSerializer

    def get_queryset(self):
        """Get consultations for the authenticated user."""
        from consultations.views import annotate_unread_count

        user = self.request.user
        qs = Consultation.objects.filter(beneficiary=user, visible_by_patient=True)
        return annotate_unread_count(qs, user)

    @extend_schema(
        responses={
            200: ConsultationSerializer,
            404: {
                "type": "object",
                "properties": {"detail": {"type": "string"}},
                "example": {"detail": "Not found."},
            },
        },
        description="Get a specific consultation by ID.",
    )
    def retrieve(self, request, *args, **kwargs):
        """Get a specific consultation by ID."""
        return super().retrieve(request, *args, **kwargs)

    @action(detail=True, methods=["post"])
    def mark_read(self, request, pk=None):
        """Mark all messages in a consultation as read for the current user."""
        from consultations.models import ConsultationReadStatus

        consultation = self.get_object()
        ConsultationReadStatus.objects.update_or_create(
            consultation=consultation,
            user=request.user,
            defaults={"last_read_at": timezone.now()},
        )
        return Response({"status": "ok"})

    @extend_schema(
        request=ConsultationMessageCreateSerializer,
        responses={
            200: ConsultationMessageSerializer(many=True),
            201: ConsultationMessageSerializer,
            404: {
                "type": "object",
                "properties": {"detail": {"type": "string"}},
                "example": {"detail": "Consultation not found."},
            },
        },
        description="Get messages for this consultation (paginated) or create a new message.",
    )
    @action(detail=True, methods=["get", "post"])
    def messages(self, request, pk=None):
        """Get messages for this consultation or create a new message."""
        consultation = self.get_object()

        if request.method == "GET":
            messages = consultation.messages.order_by("-created_at")

            # Apply pagination
            page = self.paginate_queryset(messages)
            if page is not None:
                serializer = ConsultationMessageSerializer(page, many=True)
                return self.get_paginated_response(serializer.data)

            serializer = ConsultationMessageSerializer(messages, many=True)
            return Response(serializer.data)

        elif request.method == "POST":
            serializer = ConsultationMessageCreateSerializer(
                data=request.data, context={"request": request}
            )

            if serializer.is_valid():
                message = serializer.save(consultation=consultation)
                return Response(
                    ConsultationMessageSerializer(message).data,
                    status=status.HTTP_201_CREATED,
                )

            return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

    @action(detail=True, methods=["get"])
    def join(self, request, pk=None):
        """Join a consultation call as beneficiary."""
        consultation = self.get_object()

        if consultation.closed_at:
            return Response(
                {"error": _("Cannot join call in a closed consultation.")},
                status=status.HTTP_400_BAD_REQUEST,
            )

        try:
            server = Server.get_server()
            consultation_call_info = server.instance.consultation_user_info(
                consultation, request.user
            )

            return Response(
                {
                    "url": server.url,
                    "token": consultation_call_info,
                    "room": str(consultation.room_uuid),
                }
            )
        except Exception:
            return Response(
                {"detail": _("No media server available.")},
                status=status.HTTP_404_NOT_FOUND,
            )

    @action(detail=True, methods=["post"], url_path="call_response")
    def call_response(self, request, pk=None):
        """Respond to an incoming call (accept or reject)."""
        consultation = self.get_object()
        accepted = request.data.get("accepted", False)

        # Notify the consultation owner/creator via WebSocket
        channel_layer = get_channel_layer()
        responder_name = f"{request.user.first_name} {request.user.last_name}".strip() or request.user.email

        # Notify all practitioners associated with the consultation
        users_to_notify = set()
        if consultation.owned_by:
            users_to_notify.add(consultation.owned_by.pk)
        if consultation.created_by:
            users_to_notify.add(consultation.created_by.pk)

        for user_pk in users_to_notify:
            async_to_sync(channel_layer.group_send)(
                f"user_{user_pk}",
                {
                    "type": "call_response",
                    "consultation_id": consultation.pk,
                    "accepted": accepted,
                    "responder_id": request.user.pk,
                    "responder_name": responder_name,
                },
            )

        return Response({"detail": "ok"})


class MessageAttachmentView(APIView):
    authentication_classes = [JWTAuthentication]
    permission_classes = [IsAuthenticated]

    @extend_schema(
        responses={
            200: {
                "type": "string",
                "format": "binary",
                "description": "Binary file content with appropriate Content-Type and Content-Disposition headers",
            },
            404: {
                "type": "object",
                "properties": {"detail": {"type": "string"}},
                "example": {"detail": "Message not found or no attachment."},
            },
            403: {
                "type": "object",
                "properties": {"detail": {"type": "string"}},
                "example": {
                    "detail": "You don't have permission to access this message."
                },
            },
        },
        description="Download attachment for a specific message. Returns the file as binary content with appropriate Content-Type header. User must have access to the consultation containing the message.",
    )
    def get(self, request, message_id):
        """Get attachment for a specific message if user has permission."""
        try:
            message = ConsultationMessage.objects.select_related("consultation").get(
                id=message_id
            )
        except ConsultationMessage.DoesNotExist:
            return Response(
                {"detail": "Message not found."}, status=status.HTTP_404_NOT_FOUND
            )

        user = request.user

        # Check if user has permission to access this consultation
        # Same logic as Consultation queryset: created_by, owned_by, or group member
        consultation = message.consultation

        has_access = (
            consultation.created_by == user
            or consultation.owned_by == user
            or consultation.group
            and consultation.group.users.filter(id=user.id).exists()
            or consultation.beneficiary == user
        )

        if not has_access:
            return Response(
                {"detail": "You don't have permission to access this message."},
                status=status.HTTP_403_FORBIDDEN,
            )

        # Check if message has an attachment
        if not message.attachment:
            return Response(
                {"detail": "Message has no attachment."},
                status=status.HTTP_404_NOT_FOUND,
            )

        file_name = os.path.basename(message.attachment.name)

        # Guess the content type
        content_type, _ = mimetypes.guess_type(file_name)
        if content_type is None:
            content_type = "application/octet-stream"

        # Open and return the file
        try:
            attachment_file = message.attachment.open("rb")
            response = FileResponse(attachment_file, content_type=content_type)
            response["Content-Disposition"] = f'inline; filename="{file_name}"'
            return response
        except FileNotFoundError:
            return Response(
                {"detail": "Attachment file not found."},
                status=status.HTTP_404_NOT_FOUND,
            )


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
                enum=["read", "delivered", "sent", "pending", "failed"],
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
                "Get paginated notifications",
                description="Returns paginated notifications for the user",
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
                            "created_at": "2025-01-15T10:29:00Z",
                        }
                    ],
                },
                response_only=True,
            ),
        ],
        description="Get paginated notifications (messages) where the authenticated user is the recipient. Filter by message status. Default page size is 20, max 100.",
    )
    def get(self, request):
        """Get all notifications for the authenticated user as recipient."""
        notifications = Message.objects.filter(
            sent_to=request.user, in_notification=True
        )

        # Filter by status if provided
        status = request.query_params.get("status")
        if status:
            notifications = notifications.filter(status=status)

        notifications = notifications.order_by("-created_at")

        # Apply pagination
        paginator = self.pagination_class()
        paginated_notifications = paginator.paginate_queryset(notifications, request)
        serializer = MessageSerializer(paginated_notifications, many=True, context={'request': request})
        return paginator.get_paginated_response(serializer.data)


class UserNotificationReadView(APIView):
    permission_classes = [IsAuthenticated]

    @extend_schema(
        responses={
            200: MessageSerializer,
            404: {
                "type": "object",
                "properties": {"detail": {"type": "string"}},
                "example": {"detail": "Notification not found."},
            },
            403: {
                "type": "object",
                "properties": {"detail": {"type": "string"}},
                "example": {
                    "detail": "You don't have permission to mark this notification as read."
                },
            },
        },
        description="Mark a notification as read by populating the read_at field with the current timestamp. Only the recipient can mark their notification as read.",
    )
    def post(self, request, notification_id):
        """Mark a notification as read."""
        try:
            notification = Message.objects.get(id=notification_id)
        except Message.DoesNotExist:
            return Response(
                {"detail": "Notification not found."},
                status=status.HTTP_404_NOT_FOUND,
            )

        # Check if the authenticated user is the recipient
        if notification.sent_to != request.user:
            return Response(
                {
                    "detail": "You don't have permission to mark this notification as read."
                },
                status=status.HTTP_403_FORBIDDEN,
            )

        # Mark as read by setting read_at to current time

        notification.read_at = timezone.now()
        notification.status = "read"
        notification.save()

        serializer = MessageSerializer(notification)
        return Response(serializer.data)


class UserNotificationsMarkAllReadView(APIView):
    permission_classes = [IsAuthenticated]

    @extend_schema(
        responses={
            200: {
                "type": "object",
                "properties": {
                    "detail": {"type": "string"},
                    "updated_count": {"type": "integer"},
                },
                "example": {
                    "detail": "All notifications marked as read.",
                    "updated_count": 15,
                },
            },
        },
        description="Mark all user notifications as read by setting status to 'read' and read_at to current timestamp for all notifications where the authenticated user is the recipient.",
    )
    def post(self, request):
        """Mark all user notifications as read."""
        # Get all notifications for the user that are not already read
        notifications = Message.objects.filter(sent_to=request.user).exclude(
            status="read"
        )

        # Update all notifications
        now = timezone.now()
        updated_count = notifications.update(status="read", read_at=now)

        return Response(
            {
                "detail": "All notifications marked as read.",
                "updated_count": updated_count,
            }
        )


class WebPushSubscribeView(APIView):
    authentication_classes = [JWTAuthentication]
    permission_classes = [IsAuthenticated]

    def post(self, request):
        serializer = WebPushSubscriptionSerializer(
            data=request.data, context={"request": request}
        )
        serializer.is_valid(raise_exception=True)
        serializer.save()
        return Response(serializer.data, status=status.HTTP_201_CREATED)


class WebPushUnsubscribeView(APIView):
    authentication_classes = [JWTAuthentication]
    permission_classes = [IsAuthenticated]

    def post(self, request):
        endpoint = request.data.get("endpoint")
        if not endpoint:
            return Response(
                {"detail": "endpoint is required."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        deleted, _ = WebPushSubscription.objects.filter(
            user=request.user, endpoint=endpoint
        ).delete()
        if deleted:
            return Response({"detail": "Subscription removed."})
        return Response(
            {"detail": "Subscription not found."},
            status=status.HTTP_404_NOT_FOUND,
        )


class UserAppointmentsViewSet(viewsets.ReadOnlyModelViewSet):
    authentication_classes = [JWTAuthentication]
    permission_classes = [IsAuthenticated]
    pagination_class = UniversalPagination
    serializer_class = AppointmentSerializer
    filterset_fields = ["status"]

    def get_queryset(self):
        """Get appointments where the authenticated user is an active participant."""
        return (
            Appointment.objects.filter(
                participant__user=self.request.user, participant__is_active=True
            )
            .distinct()
            .order_by("-scheduled_at")
        )

    @extend_schema(
        responses={
            200: {
                "type": "object",
                "properties": {
                    "url": {"type": "string", "description": "Media server URL"},
                    "token": {
                        "type": "string",
                        "description": "JWT token for RTC connection",
                    },
                    "room": {"type": "string", "description": "Test room name"},
                },
                "example": {
                    "url": "wss://livekit.example.com",
                    "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
                    "room": "usertest_123",
                },
            },
            500: {
                "type": "object",
                "properties": {"detail": {"type": "string"}},
                "example": {"detail": "No media server available."},
            },
        },
        description="Get RTC test connection information for the authenticated user. Returns server URL, JWT token, and room name for testing WebRTC connection.",
    )
    @action(detail=True, methods=["get"])
    def join(self, request, pk=None):
        """Join consultation call"""
        from constance import config
        from datetime import timedelta
        from consultations.models import Type

        appointment = self.get_object()
        if appointment.consultation and appointment.consultation.closed_at:
            return Response(
                {"error": "Cannot join call in closed consultation"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        if appointment.type != Type.online:
            return Response(
                {"detail": _("Cannot join consultation if not online")},
                status=status.HTTP_400_BAD_REQUEST,
            )

        now = timezone.now()
        earliest_join = appointment.scheduled_at - timedelta(minutes=config.appointment_early_join_minutes)
        if now < earliest_join:
            return Response(
                {
                    "detail": _(
                        "Too early to join. The meeting starts at %(time)s. You can join %(minutes)d minutes before the scheduled time."
                    )
                    % {"time": appointment.scheduled_at.strftime("%H:%M"), "minutes": config.appointment_early_join_minutes},
                    "scheduled_at": appointment.scheduled_at.isoformat(),
                    "code": "too_early",
                },
                status=status.HTTP_403_FORBIDDEN,
            )

        try:
            server = Server.get_server()

            consultation_call_info = server.instance.appointment_participant_info(
                appointment, request.user
            )

            # Send websocket notification to all active participants except the user who joined
            channel_layer = get_channel_layer()
            active_participants = appointment.participant_set.filter(is_active=True)

            for participant in active_participants:
                if participant.user.pk == request.user.pk:
                    continue

                async_to_sync(channel_layer.group_send)(
                    f"user_{participant.user.pk}",
                    {
                        "type": "appointment",
                        "consultation_id": appointment.consultation.pk if appointment.consultation else None,
                        "appointment_id": appointment.pk,
                        "state": "participant_joined",
                        "data": {
                            "user_id": request.user.pk,
                            "user_name": request.user.name or request.user.email,
                        },
                    },
                )

            # Create a system message for participant joined
            # The message_saved signal will automatically send WebSocket notifications
            if appointment.consultation:
                user_name = request.user.name or request.user.email
                ConsultationMessage.objects.create(
                    consultation=appointment.consultation,
                    created_by=None,  # System message has no author
                    event="participant_joined",
                    content=_("%(user_name)s joined the meeting") % {"user_name": user_name},
                )

            return Response(
                {
                    "url": server.url,
                    "token": consultation_call_info,
                    "room": str(appointment.room_uuid),
                }
            )
        except Exception as e:
            logger.exception("Failed to join appointment %s: %s", pk, e)
            return Response(
                {"detail": "No media server available."},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR,
            )

    @action(detail=True, methods=["post"])
    def leave(self, request, pk=None):
        """Mark user as having left the consultation"""
        appointment = self.get_object()

        # Vérifications
        if not appointment.consultation:
            return Response(
                {"detail": _("No consultation associated")},
                status=status.HTTP_400_BAD_REQUEST,
            )

        if appointment.consultation and appointment.consultation.closed_at:
            return Response(
                {"detail": _("Consultation is already closed")},
                status=status.HTTP_400_BAD_REQUEST,
            )

        # Créer message système "participant left"
        user_name = request.user.name or request.user.email
        consultation_id = str(appointment.consultation.id).zfill(6)
        ConsultationMessage.objects.create(
            consultation=appointment.consultation,
            created_by=None,  # Message système
            event="participant_left",
            content=_("%(user_name)s left the meeting #%(consultation_id)s") % {"user_name": user_name, "consultation_id": consultation_id},
        )

        # Notifier les autres participants via WebSocket
        channel_layer = get_channel_layer()
        active_participants = appointment.participant_set.filter(is_active=True)

        for participant in active_participants:
            if participant.user.pk == request.user.pk:
                continue

            async_to_sync(channel_layer.group_send)(
                f"user_{participant.user.pk}",
                {
                    "type": "appointment",
                    "consultation_id": appointment.consultation.pk,
                    "appointment_id": appointment.pk,
                    "state": "participant_left",
                    "data": {
                        "user_id": request.user.pk,
                        "user_name": user_name,
                    },
                },
            )

        return Response({"detail": _("Left successfully")})


class UserViewSet(viewsets.ModelViewSet):
    """
    ViewSet for users - read only with GET endpoint
    Supports search by first name, last name, and email
    Visibility controlled by USERS_VISIBILITY setting.
    When public_organisations is enabled, unauthenticated users
    can list practitioners (with bounding-box filtering).
    """

    queryset = User.objects.all()
    serializer_class = UserDetailsSerializer
    pagination_class = UniversalPagination
    filter_backends = [filters.SearchFilter, DjangoFilterBackend]
    search_fields = [
        "first_name", "last_name", "email", "mobile_phone_number",
        "street", "city", "postal_code", "country",
        "main_organisation__name", "main_organisation__city",
    ]
    filterset_class = UserFilter

    def get_permissions(self):
        if self.action == "list" and constance_config.public_organisations:
            return [AllowAny()]
        return [IsAuthenticated(), IsPractitioner()]

    def get_queryset(self):
        """
        Filter users based on visibility settings:
        - USERS_VISIBILITY controls practitioner visibility
        - PATIENT_VISIBILITY controls patient visibility
        Public (unauthenticated) access returns practitioners only.
        """
        base_queryset = self.queryset.filter(is_active=True)

        # Public access: return only practitioners with a location
        # (either their own or their main_organisation's)
        if not (self.request.user and self.request.user.is_authenticated):
            qs = base_queryset.filter(
                is_practitioner=True,
            ).select_related("main_organisation").filter(
                # User has own location OR main_organisation has location
                Q(location__isnull=False) & ~Q(location="")
                | Q(main_organisation__isnull=False)
                & Q(main_organisation__location__isnull=False)
                & ~Q(main_organisation__location="")
            )
            speciality = self.request.query_params.get("speciality")
            if speciality:
                qs = qs.filter(specialities__id=speciality)
            has_slots = self.request.query_params.get("has_slots")
            if has_slots and has_slots.lower() in ("true", "1"):
                today = timezone.now().date()
                qs = qs.filter(
                    Q(slots__isnull=False)
                    & (Q(slots__valid_until__isnull=True) | Q(slots__valid_until__gte=today))
                ).distinct()
            search = self.request.query_params.get("search")
            if search:
                qs = qs.filter(
                    Q(first_name__icontains=search)
                    | Q(last_name__icontains=search)
                    | Q(street__icontains=search)
                    | Q(city__icontains=search)
                    | Q(postal_code__icontains=search)
                    | Q(country__icontains=search)
                    | Q(main_organisation__name__icontains=search)
                    | Q(main_organisation__city__icontains=search)
                )
            else:
                qs = self._filter_by_bounding_box(qs)
            return qs

        current_user = self.request.user

        practitioners_qs = self._filter_practitioners(base_queryset, current_user)
        patients_qs = self._filter_patients(base_queryset, current_user)

        return (practitioners_qs | patients_qs).distinct()

    def _filter_practitioners(self, base_queryset, current_user):
        """Filter practitioners based on USERS_VISIBILITY setting."""
        qs = base_queryset.filter(is_practitioner=True)
        visibility = config.users_visibility

        if not visibility or visibility == "all":
            return qs

        elif visibility == "alone":
            return qs.filter(id=current_user.id)

        elif visibility == "organization":
            org_filter = self._get_organization_filter(current_user)
            if org_filter:
                return qs.filter(org_filter | Q(id=current_user.id))
            return qs.filter(id=current_user.id)

        return qs

    def _filter_patients(self, base_queryset, current_user):
        """Filter patients based on PATIENT_VISIBILITY setting."""
        qs = base_queryset.filter(is_practitioner=False)
        visibility = config.patient_visibility

        if not visibility or visibility == "all":
            return qs

        elif visibility == "alone":
            return qs.filter(created_by=current_user)

        elif visibility == "organization":
            org_filter = self._get_organization_filter(current_user)
            if org_filter is None:
                return qs.filter(created_by=current_user)
            # Patients rarely have a main_organisation/organisations set,
            # so also match via their creator's organisation (`created_by__*`).
            user_orgs = list(current_user.organisations.values_list("id", flat=True))
            creator_filter = Q()
            if current_user.main_organisation_id:
                creator_filter |= Q(
                    created_by__main_organisation=current_user.main_organisation
                )
            if user_orgs:
                creator_filter |= Q(created_by__organisations__id__in=user_orgs)
            creator_filter |= Q(created_by=current_user)
            return qs.filter(org_filter | creator_filter).distinct()

        return qs

    def _get_organization_filter(self, current_user):
        """Build a Q filter for matching organizations."""
        user_orgs = list(current_user.organisations.values_list("id", flat=True))
        has_main_org = current_user.main_organisation is not None
        has_orgs = len(user_orgs) > 0

        if not has_main_org and not has_orgs:
            return None

        filters = []
        if has_main_org:
            filters.append(Q(main_organisation=current_user.main_organisation))
        if has_orgs:
            filters.append(Q(organisations__id__in=user_orgs))

        combined = filters[0]
        for f in filters[1:]:
            combined |= f
        return combined

    def _filter_by_bounding_box(self, queryset):
        """Filter queryset by geographic bounding box.
        Uses user.location first, falls back to main_organisation.location."""
        lat_min = self.request.query_params.get("lat_min")
        lat_max = self.request.query_params.get("lat_max")
        lng_min = self.request.query_params.get("lng_min")
        lng_max = self.request.query_params.get("lng_max")
        if not all(v is not None for v in (lat_min, lat_max, lng_min, lng_max)):
            return queryset
        try:
            bounds = float(lat_min), float(lat_max), float(lng_min), float(lng_max)
        except (ValueError, TypeError):
            return queryset
        ids = []
        for obj in queryset.select_related("main_organisation"):
            loc = obj.location or (obj.main_organisation.location if obj.main_organisation else None)
            if not loc:
                continue
            try:
                lat, lng = (float(x) for x in loc.split(","))
                if bounds[0] <= lat <= bounds[1] and bounds[2] <= lng <= bounds[3]:
                    ids.append(obj.id)
            except (ValueError, AttributeError):
                continue
        return queryset.filter(id__in=ids)

    def create(self, request, *args, **kwargs):
        """
        Create a new user or merge with existing temporary user.
        If a temporary user with the same email exists, update it instead.
        """
        email = request.data.get('email')

        if email:
            try:
                # Check if a temporary user with this email exists
                existing_user = User.objects.get(email=email, temporary=True)

                # Update the existing temporary user with new data
                serializer = self.get_serializer(existing_user, data=request.data, partial=True)
                serializer.is_valid(raise_exception=True)

                # Promote temporary -> permanent, unless the toggle forces temporary accounts.
                if not constance_config.force_temporary_patients:
                    serializer.validated_data['temporary'] = False

                # Save the updated user
                serializer.save(created_by=request.user)

                headers = self.get_success_headers(serializer.data)
                return Response(serializer.data, status=status.HTTP_200_OK, headers=headers)

            except User.DoesNotExist:
                # No temporary user exists, proceed with normal creation
                pass

        # Normal user creation
        return super().create(request, *args, **kwargs)

    def perform_create(self, serializer):
        serializer.save(created_by=self.request.user)

    def update(self, request, *args, **kwargs):
        """Prevent updating users with superuser, staff access, or users in groups."""
        user = self.get_object()

        # Prevent updating superusers and staff users
        if user.is_superuser or user.is_staff:
            return Response(
                {"detail": "Cannot update users with portal or super admin access."},
                status=status.HTTP_403_FORBIDDEN,
            )

        # Prevent updating users who belong to any group
        if user.groups.exists():
            return Response(
                {"detail": "Cannot update users who belong to a group."},
                status=status.HTTP_403_FORBIDDEN,
            )

        # Prevent a practitioner from updating another practitioner
        if request.user.is_practitioner and user.is_practitioner:
            return Response(
                {"detail": "Cannot update another practitioner."},
                status=status.HTTP_403_FORBIDDEN,
            )

        return super().update(request, *args, **kwargs)

    def partial_update(self, request, *args, **kwargs):
        """Prevent partially updating users with superuser, staff access, or users in groups."""
        user = self.get_object()

        # Prevent updating superusers and staff users
        if user.is_superuser or user.is_staff:
            return Response(
                {"detail": "Cannot update users with portal or super admin access."},
                status=status.HTTP_403_FORBIDDEN,
            )


        # Prevent a practitioner from updating another practitioner
        if request.user.is_practitioner and user.is_practitioner:
            return Response(
                {"detail": "Cannot update another practitioner."},
                status=status.HTTP_403_FORBIDDEN,
            )

        return super().partial_update(request, *args, **kwargs)


class OpenIDAdapter(OpenIDConnectOAuth2Adapter):
    """Custom OpenID Connect adapter for handling callback URLs from frontend"""

    provider_id = "openid"

    def __init__(self, request):
        super().__init__(request, provider_id="openid")

    def get_callback_url(self, request, app):
        """Use callback_url from frontend request if provided"""
        if hasattr(request, "data") and "callback_url" in request.data:
            return request.data["callback_url"]
        return super().get_callback_url(request, app)


class CustomOAuth2Client(OAuth2Client):
    _pkce_code_verifier = None

    def __init__(
        self,
        request,
        consumer_key,
        consumer_secret,
        access_token_method,
        access_token_url,
        callback_url,
        _scope=None,
        scope_delimiter=" ",
        headers=None,
        basic_auth=False,
    ):
        super().__init__(
            request,
            consumer_key,
            consumer_secret,
            access_token_method,
            access_token_url,
            callback_url,
            scope_delimiter=scope_delimiter,
            headers=headers,
            basic_auth=basic_auth,
        )

    def get_access_token(self, code, pkce_code_verifier=None):
        # Use stored PKCE verifier if not provided as parameter
        if pkce_code_verifier is None and self._pkce_code_verifier is not None:
            pkce_code_verifier = self._pkce_code_verifier

        try:
            result = super().get_access_token(code, pkce_code_verifier)
            self._pkce_code_verifier = None
            return result
        except Exception as e:
            self._pkce_code_verifier = None
            logger = logging.getLogger(__name__)
            logger.error(f"OpenID token exchange failed: {e}")
            raise


class OpenIDView(SocialLoginView):
    """OpenID Connect login view with PKCE support"""

    adapter_class = OpenIDAdapter
    serializer_class = SocialLoginSerializer
    client_class = CustomOAuth2Client

    def post(self, request, *args, **kwargs):
        # Get origin from request headers
        origin = request.META.get("HTTP_ORIGIN", request.META.get("HTTP_REFERER", ""))
        if origin.endswith("/"):
            origin = origin[:-1]

        # Set callback URL dynamically
        callback_url = f"{origin}/auth/callback"
        self.callback_url = callback_url

        # Store PKCE code_verifier if present (for PKCE flow)
        if "code_verifier" in request.data:
            CustomOAuth2Client._pkce_code_verifier = request.data["code_verifier"]
        else:
            CustomOAuth2Client._pkce_code_verifier = None

        # Add callback_url to request data if not present
        if "code" in request.data and "callback_url" not in request.data:
            request.data["callback_url"] = callback_url

        response = super().post(request, *args, **kwargs)

        # If login successful, set is_practitioner to True
        if response.status_code == 200 and hasattr(self, 'user'):
            user = self.user
            if not user.is_practitioner:
                user.is_practitioner = True
                user.save(update_fields=['is_practitioner'])

        return response


class AppConfigView(APIView):
    """
    Public endpoint returning application configuration for the frontend.
    Includes OpenID, registration settings, and main organization info.
    """

    permission_classes = []
    authentication_classes = []

    @extend_schema(
        description="Get application configuration for the frontend.",
    )
    def get(self, request):

        # OpenID Connect configuration - read from tenant's DB
        openid = {
            "enabled": False,
            "client_id": None,
            "authorization_url": None,
            "provider_name": None,
        }

        social_app = SocialApp.objects.filter(provider="openid_connect").first()
        if social_app:
            server_url = social_app.settings.get("server_url", "")
            authorization_url = None
            if server_url:
                base_url = server_url.replace("/.well-known/openid-configuration", "")
                authorization_url = f"{base_url}/protocol/openid-connect/auth"

            openid = {
                "enabled": bool(social_app.client_id),
                "client_id": social_app.client_id,
                "authorization_url": authorization_url,
                "provider_name": social_app.name,
            }

        # Main organization
        main_org = Organisation.objects.filter(is_main=True).first()
        main_organization = OrganisationSerializer(main_org, context={"request": request}).data if main_org else None

        def _image_url(image_field):
            if not image_field:
                return None
            return request.build_absolute_uri(image_field.url)

        languages = [
            {"code": code, "name": str(name)} for code, name in settings.LANGUAGES
        ]

        from messaging.models import MessagingProvider

        communication_methods = list(
            MessagingProvider.objects.filter(is_active=True)
            .values_list("communication_method", flat=True)
            .distinct()
        )

        return Response(
            {
                **openid,
                "registration_enabled": constance_config.enable_registration,
                "disable_password_login": constance_config.disable_password_login,
                "main_organization": main_organization,
                "branding": constance_config.site_name,
                "primary_color_patient": main_org.primary_color_patient if main_org else None,
                "primary_color_practitioner": main_org.primary_color_practitioner if main_org else None,
                "languages": languages,
                "communication_methods": communication_methods,
                "vapid_public_key": settings.WEBPUSH_VAPID_PUBLIC_KEY,
                "consultation_auto_delete_hours": int(constance_config.consultation_auto_delete_hours),
                "appointment_early_join_minutes": int(constance_config.appointment_early_join_minutes),
                "enable_video_recording": constance_config.enable_video_recording,
                "enable_live_transcription": constance_config.enable_live_transcription,
                "public_organisations": constance_config.public_organisations,
                "force_temporary_patients": constance_config.force_temporary_patients,
            }
        )


class LoginView(DjRestAuthLoginView):
    """Login endpoint controlled by disable_password_login constance setting for practitioners."""

    def post(self, request, *args, **kwargs):

        if constance_config.disable_password_login:
            # Check if the user trying to log in is a practitioner
            email = request.data.get("email")
            if email:
                try:
                    user = User.objects.get(email=email)
                    if user.is_practitioner:
                        return Response(
                            {"detail": "Password login is disabled for practitioners. Please use SSO."},
                            status=status.HTTP_403_FORBIDDEN,
                        )
                except User.DoesNotExist:
                    pass
        return super().post(request, *args, **kwargs)


class PasswordChangeView(DjRestAuthPasswordChangeView):
    """Password change endpoint controlled by DISABLE_PASSWORD_LOGIN setting for practitioners."""

    def post(self, request, *args, **kwargs):
        if constance_config.disable_password_login and request.user.is_authenticated and request.user.is_practitioner:
            return Response(
                {"detail": "Password management is disabled for practitioners. Please use SSO."},
                status=status.HTTP_403_FORBIDDEN,
            )
        return super().post(request, *args, **kwargs)


class PasswordResetView(DjRestAuthPasswordResetView):
    """Password reset endpoint controlled by DISABLE_PASSWORD_LOGIN setting for practitioners."""

    def post(self, request, *args, **kwargs):
        if constance_config.disable_password_login:
            # Check if the user requesting reset is a practitioner
            email = request.data.get("email")
            if email:
                try:
                    user = User.objects.get(email=email)
                    if user.is_practitioner:
                        return Response(
                            {"detail": "Password reset is disabled for practitioners. Please use SSO."},
                            status=status.HTTP_403_FORBIDDEN,
                        )
                except User.DoesNotExist:
                    pass
        return super().post(request, *args, **kwargs)


class PasswordResetConfirmView(DjRestAuthPasswordResetConfirmView):
    """Password reset confirm endpoint controlled by DISABLE_PASSWORD_LOGIN setting for practitioners."""

    def post(self, request, *args, **kwargs):
        # For password reset confirm, we can't easily check user type before validation
        # So we allow the reset to proceed - the practitioner shouldn't have received the email anyway
        # if PasswordResetView blocked them
        return super().post(request, *args, **kwargs)


class RegisterView(DjRestAuthRegisterView):
    """Registration endpoint controlled by ENABLE_REGISTRATION setting."""

    def create(self, request, *args, **kwargs):
        if not constance_config.enable_registration:
            return Response(
                {"detail": "Registration is currently disabled."},
                status=status.HTTP_403_FORBIDDEN,
            )
        super().create(request, *args, **kwargs)

        # Send email verification message
        email = request.data.get("email")
        if email:
            user = User.objects.filter(email=email).first()
            if user and not user.email_verified:
                user.email_verification_token = str(uuid.uuid4())
                user.save(update_fields=["email_verification_token"])
                Message.objects.create(
                    sent_to=user,
                    template_system_name="email_verification",
                    content_type=ContentType.objects.get_for_model(user),
                    object_id=user.pk,
                    in_notification=False,
                    additionnal_link_args={"token": user.email_verification_token},
                )

        return Response(
            {
                "detail": _("A verification email has been sent to your email address.")
            },
            status=status.HTTP_201_CREATED,
        )


class EmailVerifyView(APIView):
    """Verify user email address via token."""

    permission_classes = []
    authentication_classes = []

    def get(self, request):
        token = request.query_params.get("token")
        if not token:
            return Response(
                {"detail": "Verification token is required."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        user = User.objects.filter(email_verification_token=token).first()
        if not user:
            return Response(
                {"detail": "Invalid or expired verification token."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        user.email_verified = True
        user.email_verification_token = None
        user.is_active = True
        user.save(update_fields=["email_verified", "email_verification_token", "is_active"])

        return Response({"detail": "Email verified successfully."})


class TestRTCView(APIView):
    authentication_classes = [JWTAuthentication]
    permission_classes = [IsAuthenticated]

    @extend_schema(
        responses={
            200: {
                "type": "object",
                "properties": {
                    "url": {"type": "string", "description": "Media server URL"},
                    "token": {
                        "type": "string",
                        "description": "JWT token for RTC connection",
                    },
                    "room": {"type": "string", "description": "Test room name"},
                },
                "example": {
                    "url": "wss://livekit.example.com",
                    "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
                    "room": "usertest_123",
                },
            },
            500: {
                "type": "object",
                "properties": {"detail": {"type": "string"}},
                "example": {"detail": "No media server available."},
            },
        },
        description="Get RTC test connection information for the authenticated user. Returns server URL, JWT token, and room name for testing WebRTC connection.",
    )
    def get(self, request):
        """Get RTC test information for the authenticated user."""
        try:
            server = Server.get_server()

            test_room_uuid = uuid.uuid4()
            test_info = server.instance.user_test_info(request.user, room_uuid=test_room_uuid)

            return Response(
                {
                    "url": server.url,
                    "token": test_info,
                    "room": str(test_room_uuid),
                }
            )
        except Exception as e:
            return Response(
                {"detail": "No media server available."},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR,
            )


class UserDashboardView(APIView):
    authentication_classes = [JWTAuthentication]
    permission_classes = [IsAuthenticated]

    @extend_schema(
        responses={
            200: {
                "type": "object",
                "properties": {
                    "requests": {
                        "type": "array",
                        "description": "Last 10 requests created by the user",
                    },
                    "consultations": {
                        "type": "array",
                        "description": "Last 10 consultations where the user is the beneficiary",
                    },
                    "appointments": {
                        "type": "array",
                        "description": "Last 10 appointments where the user is a participant",
                    },
                },
            },
        },
        description="Get dashboard data for the authenticated user: 10 requests, 10 consultations (as beneficiary), and 10 appointments.",
    )
    def get(self, request):
        """Get dashboard data for the authenticated user."""
        user = request.user
        now = timezone.now()
        two_hours_ago = now - timezone.timedelta(hours=2)

        user_requests = (
            Request.objects.filter(
                created_by=user,
            )
            .filter(
                Q(status__in=[RequestStatus.requested,
                  RequestStatus.refused, RequestStatus.cancelled],
                  created_at__gte=two_hours_ago)
                | Q(
                    status=RequestStatus.accepted,
                    consultation__closed_at__isnull=True,
                )
                | Q(
                    status=RequestStatus.accepted,
                    appointment__scheduled_at__gte=two_hours_ago,
                    appointment__status="scheduled",
                )
            )
            .order_by("-id")
        )

        from consultations.views import annotate_unread_count

        consultations = annotate_unread_count(
            Consultation.objects.exclude(request__in=user_requests)
            .filter(beneficiary=user, closed_at__isnull=True, visible_by_patient=True)
            .order_by("-created_at"),
            user,
        )

        # Next upcoming appointment (with 2 hour grace period)
        next_appointment = (
            Appointment.objects.filter(
                participant__user=user,
                participant__is_active=True,
                scheduled_at__gte=two_hours_ago,
                status="scheduled",
            )
            .distinct()
            .order_by("scheduled_at")
            .first()
        )

        appointments = (
            Appointment.objects.exclude(consultation__in=consultations)
            .exclude(
                consultation__request__in=user_requests,
            ).filter(
                participant__user=user,
                participant__is_active=True,
                scheduled_at__gte=two_hours_ago,
                status="scheduled",
            )
            .distinct()
            .order_by("scheduled_at")
        )

        serializer_context = {"request": request}

        has_reasons = Reason.objects.filter(is_active=True).exists()

        return Response(
            {
                "has_reasons": has_reasons,
                "next_appointment": AppointmentSerializer(
                    next_appointment, context=serializer_context
                ).data
                if next_appointment
                else None,
                "requests": RequestSerializer(
                    user_requests, many=True, context=serializer_context
                ).data,
                "consultations": ConsultationSerializer(
                    consultations, many=True, context=serializer_context
                ).data,
                "appointments": AppointmentSerializer(
                    appointments, many=True, context=serializer_context
                ).data,
            }
        )


class SendVerificationCodeView(APIView):
    """
    Generate and send a verification code to a contact's email for passwordless authentication.
    """

    permission_classes = [AllowAny]

    @extend_schema(
        summary="Send Verification Code",
        description="Generate and send a verification code for passwordless authentication. Automatically detects if the email belongs to a contact or user.",
        request={
            "application/json": {
                "type": "object",
                "properties": {
                    "email": {
                        "type": "string",
                        "format": "email",
                        "description": "Email address to send the verification code to",
                        "example": "user@example.com",
                    },
                },
                "required": ["email"],
            }
        },
        responses={
            200: {
                "description": "Verification code sent successfully",
                "content": {
                    "application/json": {
                        "example": {"detail": "Verification code sent successfully"}
                    }
                },
            },
            400: {
                "description": "Bad request",
                "content": {
                    "application/json": {"example": {"error": "email is required"}}
                },
            },
        },
    )
    def post(self, request):
        email = request.data.get("email")

        if not email:
            return Response(
                {"error": "email is required"}, status=status.HTTP_400_BAD_REQUEST
            )

        # Try to find contact first, then user
        user_instance = None

        try:
            # Try to get User
            user_instance = User.objects.get(email__iexact=email.strip())
        except User.DoesNotExist:
            return Response(
                {"detail": "Verification code sent successfully"},
                status=status.HTTP_200_OK,
            )

        # Generate a verification code (6 digits)
        user_instance.verification_code = 100000 + secrets.randbelow(900000)
        user_instance.verification_code_created_at = timezone.now()

        user_instance.one_time_auth_token = str(uuid.uuid4())
        user_instance.verification_attempts = 0
        user_instance.save(
            update_fields=[
                "verification_code",
                "verification_code_created_at",
                "verification_attempts",
                "one_time_auth_token",
            ]
        )

        # Render HTML template
        with translation.override(user_instance.preferred_language):
            Message.objects.create(
                sent_to=user_instance,
                template_system_name="your_authentication_code",
                content_type=ContentType.objects.get_for_model(user_instance),
                object_id=user_instance.pk,
            )

        return Response(
            {
                "detail": "Verification code sent successfully",
                "auth_token": user_instance.one_time_auth_token,
            },
            status=status.HTTP_200_OK,
        )


# -- FHIR Patient / Practitioner -------------------------------------------

from fhir_server.mixins import FhirViewSetMixin  # noqa: E402
from .fhir import PatientFhirMapper, PractitionerFhirMapper  # noqa: E402


class PatientViewSet(FhirViewSetMixin, viewsets.ModelViewSet):
    """
    FHIR R4 Patient endpoint. All requests run through the HCW permission
    model (`IsAuthenticated, IsPractitioner`) and return FHIR responses
    when the client requests `application/fhir+json`.
    """

    queryset = User.objects.filter(is_practitioner=False)
    serializer_class = UserDetailsSerializer
    permission_classes = [IsAuthenticated, IsPractitioner]
    pagination_class = UniversalPagination
    fhir_class = PatientFhirMapper
    http_method_names = ["get", "post", "put", "patch", "delete", "head", "options"]

    def get_queryset(self):
        return self.queryset.filter(is_active=True)

    @action(detail=True, methods=["post"])
    def access_url(self, request, pk=None):
        """Get or regenerate a magic-link access URL for a patient who has no
        email (so the verification-code flow is unavailable) or who is
        explicitly configured with `manual` communication. Token is created
        on the fly if missing.
        """
        from datetime import timedelta

        user = self.get_object()

        allowed = not user.email or user.communication_method == "manual"
        if not allowed:
            return Response(
                {"detail": _("Access URL is only available for patients without an email or with manual communication")},
                status=status.HTTP_400_BAD_REQUEST,
            )

        token_expiry = timedelta(hours=constance_config.temporary_participant_token_expiry_hours)
        now = timezone.now()
        token_expired = (
            not user.one_time_auth_token
            or not user.verification_code_created_at
            or (now - user.verification_code_created_at) > token_expiry
        )

        if token_expired:
            user.one_time_auth_token = str(uuid.uuid4())
            user.verification_code_created_at = now
            user.save(update_fields=["one_time_auth_token", "verification_code_created_at"])

        access_url = f"{constance_config.patient_base_url}/?auth={user.one_time_auth_token}"

        expires_at = user.verification_code_created_at + token_expiry if user.verification_code_created_at else None
        if expires_at and request.user.is_authenticated:
            user_tz = request.user.user_tz
            expires_at = expires_at.astimezone(user_tz).isoformat()

        return Response({
            "access_url": access_url,
            "token_created_at": user.verification_code_created_at,
            "expires_at": expires_at,
        })


class PractitionerViewSet(FhirViewSetMixin, viewsets.ModelViewSet):
    """FHIR R4 Practitioner endpoint (users with `is_practitioner=True`)."""

    queryset = User.objects.filter(is_practitioner=True)
    serializer_class = UserDetailsSerializer
    permission_classes = [IsAuthenticated, IsPractitioner]
    pagination_class = UniversalPagination
    fhir_class = PractitionerFhirMapper
    http_method_names = ["get", "post", "put", "patch", "delete", "head", "options"]

    def get_queryset(self):
        return self.queryset.filter(is_active=True)
