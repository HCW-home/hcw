from django.shortcuts import render
from rest_framework import viewsets, status
from rest_framework.decorators import action
from rest_framework.response import Response
from rest_framework.pagination import PageNumberPagination
from rest_framework.views import APIView
from django.db.models import Q
from rest_framework.permissions import IsAuthenticated, DjangoModelPermissions
from core.mixins import CreatedByMixin
from rest_framework.exceptions import PermissionDenied, ValidationError
from drf_spectacular.utils import extend_schema, OpenApiParameter, OpenApiTypes, OpenApiExample
from .permissions import ConsultationPermission
from .models import Consultation, Queue, Appointment, Participant, Message, AppointmentStatus, Request, RequestStatus, Reason, BookingSlot
from django.utils import timezone
from django.contrib.auth import get_user_model
from datetime import datetime, timedelta, time, date
from dataclasses import dataclass
from typing import List
from .serializers import (
    ConsultationSerializer,
    ConsultationCreateSerializer,
    QueueSerializer, 
    AppointmentSerializer,
    ParticipantSerializer,
    ConsultationMessageSerializer,
    RequestSerializer,
    BookingSlotSerializer
)

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

@dataclass
class Slot:
    date: date
    start_time: time
    end_time: time
    duration: int
    user_id: int
    user_email: str
    user_first_name: str
    user_last_name: str

from messaging.tasks import send_message_task


class ConsultationPagination(PageNumberPagination):
    page_size = 20
    page_size_query_param = 'page_size'
    max_page_size = 100


class ConsultationViewSet(CreatedByMixin, viewsets.ModelViewSet):
    '''Consultation endpoint'''
    serializer_class = ConsultationSerializer
    permission_classes = [IsAuthenticated, DjangoModelPermissionsWithView]
    pagination_class = ConsultationPagination
    filterset_fields = ['group', 'beneficiary', 'created_by', 'owned_by']
    ordering = ['-created_at']
    ordering_fields = ['created_at', 'updated_at', 'closed_at']
    
    def get_serializer_class(self):
        if self.action == 'create':
            return ConsultationCreateSerializer
        return ConsultationSerializer
    
    def get_queryset(self):
        user = self.request.user
        if not user.is_authenticated:
            return Consultation.objects.none()
        
        # Return consultations created by the user OR 
        # consultations from groups the user belongs to
        return Consultation.objects.filter(
            Q(created_by=user) | 
            Q(owned_by=user) |
            Q(group__users=user)
        ).distinct()
    
    @extend_schema(responses=ConsultationSerializer)
    @action(detail=True, methods=['post'])
    def close(self, request, pk=None):
        """Close a consultation"""
        consultation = self.get_object()
        if consultation.closed_at is not None:
            return Response(
                {'error': 'This consultation is already closed'}, 
                status=status.HTTP_400_BAD_REQUEST
            )
        
        consultation.closed_at = timezone.now()
        consultation.save()
        
        serializer = self.get_serializer(consultation)
        return Response(serializer.data)
    
    @extend_schema(responses=ConsultationSerializer)
    @action(detail=True, methods=['post'])
    def reopen(self, request, pk=None):
        """Reopen a consultation"""
        consultation = self.get_object()
        if consultation.closed_at is None:
            return Response(
                {'error': 'This consultation is already open'}, 
                status=status.HTTP_400_BAD_REQUEST
            )
        
        consultation.closed_at = None
        consultation.save()
        
        serializer = self.get_serializer(consultation)
        return Response(serializer.data)
    
    @extend_schema(
        request=AppointmentSerializer, 
        responses={200: AppointmentSerializer(many=True), 201: AppointmentSerializer}
    )
    @action(detail=True, methods=['get', 'post'])
    def appointments(self, request, pk=None):
        """Get all appointments for this consultation or create a new appointment"""
        consultation = self.get_object()
        
        if request.method == 'GET':
            appointments = consultation.appointments.all()
            
            page = self.paginate_queryset(appointments)
            if page is not None:
                serializer = AppointmentSerializer(page, many=True)
                return self.get_paginated_response(serializer.data)
            
            serializer = AppointmentSerializer(appointments, many=True)
            return Response(serializer.data)
        
        elif request.method == 'POST':
            serializer = AppointmentSerializer(
                data=request.data,
                context={'request': request, 'consultation': consultation}
            )

            if serializer.is_valid():
                appointment = serializer.save(
                    consultation=consultation,
                    created_by=request.user
                )

                response_serializer = AppointmentSerializer(appointment)
                return Response(response_serializer.data, status=status.HTTP_201_CREATED)

            return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

    @extend_schema(
        request=ConsultationMessageSerializer, 
        responses={200: ConsultationMessageSerializer(many=True), 201: ConsultationMessageSerializer}
    )
    @action(detail=True, methods=['get', 'post'])
    def messages(self, request, pk=None):
        """Get all messages for this consultation or create a new message"""
        consultation = self.get_object()
        
        if request.method == 'GET':
            messages = consultation.messages.all()
            
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
                return Response(ConsultationMessageSerializer(message).data, status=status.HTTP_201_CREATED)

            return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

    @extend_schema(
        responses=AppointmentSerializer,
        parameters=[
            OpenApiParameter(
                name='appointment_id',
                type=OpenApiTypes.INT,
                location=OpenApiParameter.PATH,
                description='ID of the appointment to retrieve'
            )
        ]
    )
    @action(detail=True, methods=['get'], url_path='appointment/(?P<appointment_id>[^/.]+)')
    def get_appointment(self, request, pk=None, appointment_id=None):
        """Get a specific appointment for this consultation"""
        consultation = self.get_object()
        
        try:
            appointment = consultation.appointments.get(id=appointment_id)
        except Appointment.DoesNotExist:
            return Response(
                {'error': 'Appointment not found in this consultation'}, 
                status=status.HTTP_404_NOT_FOUND
            )
        
        serializer = AppointmentSerializer(appointment)
        return Response(serializer.data)

    @extend_schema(
        request=ParticipantSerializer, 
        responses={200: ParticipantSerializer(many=True), 201: ParticipantSerializer},
        parameters=[
            OpenApiParameter(
                name='appointment_id',
                type=OpenApiTypes.INT,
                location=OpenApiParameter.PATH,
                description='ID of the appointment'
            )
        ]
    )
    @action(detail=True, methods=['get', 'post'], url_path='appointment/(?P<appointment_id>[^/.]+)/participants')
    def appointment_participants(self, request, pk=None, appointment_id=None):
        """Get all participants for a specific appointment in this consultation or create a new participant"""
        consultation = self.get_object()
        
        try:
            appointment = consultation.appointments.get(id=appointment_id)
        except Appointment.DoesNotExist:
            return Response(
                {'error': 'Appointment not found in this consultation'}, 
                status=status.HTTP_404_NOT_FOUND
            )
        
        if request.method == 'GET':
            participants = appointment.participant_set.all()
            
            page = self.paginate_queryset(participants)
            if page is not None:
                serializer = ParticipantSerializer(page, many=True)
                return self.get_paginated_response(serializer.data)
            
            serializer = ParticipantSerializer(participants, many=True)
            return Response(serializer.data)
        
        elif request.method == 'POST':
            serializer = ParticipantSerializer(
                data=request.data,
                context={'request': request}
            )
            
            if serializer.is_valid():
                participant = serializer.save(appointement=appointment)
                return Response(
                    ParticipantSerializer(participant).data, 
                    status=status.HTTP_201_CREATED
                )
            
            return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

    @extend_schema(
        responses={204: None},
        parameters=[
            OpenApiParameter(
                name='appointment_id',
                type=OpenApiTypes.INT,
                location=OpenApiParameter.PATH,
                description='ID of the appointment'
            ),
            OpenApiParameter(
                name='participant_id',
                type=OpenApiTypes.INT,
                location=OpenApiParameter.PATH,
                description='ID of the participant to delete'
            )
        ]
    )
    @action(detail=True, methods=['delete'], url_path='appointment/(?P<appointment_id>[^/.]+)/participants/(?P<participant_id>[^/.]+)')
    def delete_participant(self, request, pk=None, appointment_id=None, participant_id=None):
        """Delete a specific participant from an appointment in this consultation"""
        consultation = self.get_object()
        
        try:
            appointment = consultation.appointments.get(id=appointment_id)
        except Appointment.DoesNotExist:
            return Response(
                {'error': 'Appointment not found in this consultation'}, 
                status=status.HTTP_404_NOT_FOUND
            )
        
        try:
            participant = appointment.participant_set.get(id=participant_id)
        except Participant.DoesNotExist:
            return Response(
                {'error': 'Participant not found in this appointment'}, 
                status=status.HTTP_404_NOT_FOUND
            )
        
        participant.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)

    @extend_schema(
        responses=AppointmentSerializer,
        parameters=[
            OpenApiParameter(
                name='appointment_id',
                type=OpenApiTypes.INT,
                location=OpenApiParameter.PATH,
                description='ID of the appointment to cancel'
            )
        ]
    )
    @action(detail=True, methods=['post'], url_path='appointment/(?P<appointment_id>[^/.]+)/cancel')
    def cancel_appointment(self, request, pk=None, appointment_id=None):
        """Cancel a specific appointment in this consultation"""
        consultation = self.get_object()
        
        try:
            appointment = consultation.appointments.get(id=appointment_id)
        except Appointment.DoesNotExist:
            return Response(
                {'error': 'Appointment not found in this consultation'}, 
                status=status.HTTP_404_NOT_FOUND
            )
        
        if appointment.status == 'cancelled':
            return Response(
                {'error': 'This appointment is already cancelled'}, 
                status=status.HTTP_400_BAD_REQUEST
            )
        
        appointment.status = AppointmentStatus.CANCELLED
        appointment.save()
        
        serializer = AppointmentSerializer(appointment)
        return Response(serializer.data)

class QueueViewSet(viewsets.ReadOnlyModelViewSet):
    """
    ViewSet for queues - read only
    Users can only see queues they belong to
    """
    serializer_class = QueueSerializer
    permission_classes = [IsAuthenticated]
    
    def get_queryset(self):
        user = self.request.user
        if not user.is_authenticated:
            return Queue.objects.none()
        
        # Return queues where:
        # 1. User is directly assigned to the queue, OR
        # 2. Queue has no organizations (public queues), OR  
        # 3. Queue belongs to an organization the user is a member of
        from django.db.models import Q, Count
        return Queue.objects.annotate(
            org_count=Count('organisation')
        ).filter(
            Q(users=user) |
            Q(org_count=0) |
            Q(organisation__in=user.organisations.all())
        ).distinct()

class RequestViewSet(CreatedByMixin, viewsets.ModelViewSet):
    """
    ViewSet for consultation requests
    Users can create requests and view their own requests
    """
    serializer_class = RequestSerializer
    permission_classes = [IsAuthenticated]
    http_method_names = ['get', 'post', 'head', 'options']  # Remove PUT, PATCH, DELETE
    
    def get_queryset(self):
        user = self.request.user
        if not user.is_authenticated:
            return Request.objects.none()
        
        # Users can see requests they created
        return Request.objects.filter(created_by=user)

    @extend_schema(responses=RequestSerializer)
    @action(detail=True, methods=['post'])
    def cancel(self, request, pk=None):
        """Cancel a consultation request"""
        consultation_request = self.get_object()
        
        if consultation_request.status == RequestStatus.CANCELLED:
            return Response(
                {'error': 'This request is already cancelled'}, 
                status=status.HTTP_400_BAD_REQUEST
            )
        
        consultation_request.status = RequestStatus.CANCELLED
        consultation_request.save()
        
        serializer = self.get_serializer(consultation_request)
        return Response(serializer.data)


class ReasonSlotsView(APIView):
    permission_classes = [IsAuthenticated]
    
    @extend_schema(
        parameters=[
            OpenApiParameter(
                name="from_date",
                description="Start date for slot search (default: today). Format: YYYY-MM-DD",
                required=False,
                type=OpenApiTypes.DATE,
                location=OpenApiParameter.QUERY,
            ),
            OpenApiParameter(
                name="user_id",
                description="Filter slots for a specific practitioner",
                required=False,
                type=OpenApiTypes.INT,
                location=OpenApiParameter.QUERY,
            ),
            OpenApiParameter(
                name="organisation_id",
                description="Filter slots for practitioners from a specific organisation",
                required=False,
                type=OpenApiTypes.INT,
                location=OpenApiParameter.QUERY,
            ),
        ],
        responses={
            200: {
                'type': 'array',
                'items': {
                    'type': 'object',
                    'properties': {
                        'date': {'type': 'string', 'format': 'date'},
                        'start_time': {'type': 'string', 'format': 'time'},
                        'end_time': {'type': 'string', 'format': 'time'},
                        'duration': {'type': 'integer'},
                        'user_id': {'type': 'integer'},
                        'user_email': {'type': 'string'},
                        'user_first_name': {'type': 'string'},
                        'user_last_name': {'type': 'string'},
                    }
                }
            }
        },
        examples=[
            OpenApiExample(
                'Available slots',
                description='Returns available time slots for practitioners',
                value=[
                    {
                        "date": "2025-01-16",
                        "start_time": "09:00:00",
                        "end_time": "09:30:00",
                        "duration": 30,
                        "user_id": 5,
                        "user_email": "doctor@example.com",
                        "user_first_name": "Dr. John",
                        "user_last_name": "Smith"
                    }
                ],
                response_only=True
            ),
        ],
        description="Get available time slots for practitioners based on a reason. Returns slots for the next 7 days from the specified date."
    )
    def get(self, request, id):
        """Get available slots for practitioners based on reason."""
        try:
            reason = Reason.objects.get(id=id, is_active=True)
        except Reason.DoesNotExist:
            return Response({"error": "Reason not found or inactive"}, status=status.HTTP_404_NOT_FOUND)
        
        # Parse from_date parameter
        from_date_str = request.query_params.get('from_date')
        if from_date_str:
            try:
                from_date = datetime.strptime(from_date_str, '%Y-%m-%d').date()
            except ValueError:
                return Response({"error": "Invalid date format. Use YYYY-MM-DD"}, status=status.HTTP_400_BAD_REQUEST)
        else:
            # Use user's timezone to determine today's date
            from_date = timezone.now().date()
        
        # Parse user_id filter
        user_id_filter = request.query_params.get('user_id')
        if user_id_filter:
            try:
                user_id_filter = int(user_id_filter)
            except ValueError:
                return Response({"error": "Invalid user_id"}, status=status.HTTP_400_BAD_REQUEST)
        
        # Parse organisation_id filter
        organisation_id_filter = request.query_params.get('organisation_id')
        if organisation_id_filter:
            try:
                organisation_id_filter = int(organisation_id_filter)
            except ValueError:
                return Response({"error": "Invalid organisation_id"}, status=status.HTTP_400_BAD_REQUEST)
        
        # Get practitioners with the required specialty
        practitioners_query = User.objects.filter(specialities=reason.speciality)
        if user_id_filter:
            practitioners_query = practitioners_query.filter(id=user_id_filter)
        if organisation_id_filter:
            practitioners_query = practitioners_query.filter(main_organisation_id=organisation_id_filter)
        
        practitioners = list(practitioners_query)
        if not practitioners:
            return Response([], status=status.HTTP_200_OK)
        
        # Generate dates for next 7 days
        dates = [from_date + timedelta(days=i) for i in range(7)]
        
        # Get all booking slots for practitioners
        booking_slots = BookingSlot.objects.filter(
            user__in=practitioners
        ).select_related('user')
        
        # Get all existing appointments for the next 7 days
        end_date = from_date + timedelta(days=7)
        existing_appointments = Appointment.objects.filter(
            scheduled_at__date__gte=from_date,
            scheduled_at__date__lt=end_date,
            status=AppointmentStatus.SCHEDULED
        ).select_related('consultation')
        
        # Create appointment lookup by practitioner and datetime
        appointment_lookup = {}
        for apt in existing_appointments:
            # Get practitioners from consultation participants or other logic
            # For simplicity, we'll check if the practitioner is the consultation owner
            consultation = apt.consultation
            if consultation.owned_by:
                practitioner_id = consultation.owned_by.id
                apt_start = apt.scheduled_at
                apt_end = apt.end_expected_at or (apt_start + timedelta(minutes=reason.duration))
                
                if practitioner_id not in appointment_lookup:
                    appointment_lookup[practitioner_id] = []
                appointment_lookup[practitioner_id].append((apt_start, apt_end))
        
        # Generate available slots
        available_slots = []
        # Use a set to track unique slots to prevent duplicates from overlapping booking slots
        seen_slots = set()
        
        for practitioner in practitioners:
            practitioner_slots = booking_slots.filter(user=practitioner)
            
            for booking_slot in practitioner_slots:
                for target_date in dates:
                    # Check if slot is valid for this specific date
                    if booking_slot.valid_until and booking_slot.valid_until <= target_date:
                        continue
                    
                    # Check if this day is enabled in booking slot
                    weekday = target_date.weekday()  # 0=Monday, 6=Sunday
                    day_enabled = False
                    
                    if weekday == 0 and booking_slot.monday:
                        day_enabled = True
                    elif weekday == 1 and booking_slot.tuesday:
                        day_enabled = True
                    elif weekday == 2 and booking_slot.wednesday:
                        day_enabled = True
                    elif weekday == 3 and booking_slot.thursday:  # Note: there's a typo in the model
                        day_enabled = True
                    elif weekday == 4 and booking_slot.friday:
                        day_enabled = True
                    elif weekday == 5 and booking_slot.saturday:
                        day_enabled = True
                    elif weekday == 6 and booking_slot.sunday:
                        day_enabled = True
                    
                    if not day_enabled:
                        continue
                    
                    # Generate time slots for this day
                    current_time = booking_slot.start_time
                    end_time = booking_slot.end_time
                    
                    while current_time < end_time:
                        slot_start_datetime = datetime.combine(target_date, current_time)
                        slot_end_time = (datetime.combine(target_date, current_time) + timedelta(minutes=reason.duration)).time()
                        
                        # Check if slot goes beyond end_time
                        if slot_end_time > end_time:
                            break
                            
                        # Skip if slot overlaps with break time (only if break times are set)
                        if (booking_slot.start_break and booking_slot.end_break and
                            current_time < booking_slot.end_break and 
                            slot_end_time > booking_slot.start_break):
                            current_time = booking_slot.end_break
                            continue
                        
                        # Check if slot conflicts with existing appointments
                        slot_conflicts = False
                        practitioner_appointments = appointment_lookup.get(practitioner.id, [])
                        
                        for apt_start, apt_end in practitioner_appointments:
                            slot_end_datetime = datetime.combine(target_date, slot_end_time)
                            
                            # Check for overlap
                            if (slot_start_datetime < apt_end and slot_end_datetime > apt_start):
                                slot_conflicts = True
                                break
                        
                        if not slot_conflicts:
                            # Create unique identifier for this slot to prevent duplicates
                            slot_key = (target_date, current_time, practitioner.id)
                            
                            if slot_key not in seen_slots:
                                seen_slots.add(slot_key)
                                available_slots.append(Slot(
                                    date=target_date,
                                    start_time=current_time,
                                    end_time=slot_end_time,
                                    duration=reason.duration,
                                    user_id=practitioner.id,
                                    user_email=practitioner.email,
                                    user_first_name=practitioner.first_name or '',
                                    user_last_name=practitioner.last_name or ''
                                ))
                        
                        # Move to next slot
                        current_time = (datetime.combine(target_date, current_time) + timedelta(minutes=reason.duration)).time()
        
        # Convert slots to dict for JSON response
        slots_data = []
        for slot in available_slots:
            slots_data.append({
                'date': slot.date.isoformat(),
                'start_time': slot.start_time.isoformat(),
                'end_time': slot.end_time.isoformat(),
                'duration': slot.duration,
                'user_id': slot.user_id,
                'user_email': slot.user_email,
                'user_first_name': slot.user_first_name,
                'user_last_name': slot.user_last_name,
            })
        
        return Response(slots_data, status=status.HTTP_200_OK)


class BookingSlotViewSet(CreatedByMixin, viewsets.ModelViewSet):
    serializer_class = BookingSlotSerializer
    permission_classes = [IsAuthenticated, DjangoModelPermissionsWithView]
    pagination_class = ConsultationPagination
    filterset_fields = ['user', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday', 'valid_until']
    ordering = ['-id']
    ordering_fields = ['id', 'start_time', 'end_time', 'valid_until']
    
    def get_queryset(self):
        user = self.request.user
        if not user.is_authenticated:
            return BookingSlot.objects.none()
        
        # Users can only see their own booking slots
        return BookingSlot.objects.filter(user=user)
    
    def perform_update(self, serializer):
        user = self.request.user
        instance = serializer.instance
        
        # Ensure user can only update their own booking slots
        if instance.user != user:
            raise PermissionDenied("You can only update your own booking slots.")
        
        serializer.save()
    
    def perform_destroy(self, instance):
        user = self.request.user
        
        # Ensure user can only delete their own booking slots
        if instance.user != user:
            raise PermissionDenied("You can only delete your own booking slots.")
        
        instance.delete()
