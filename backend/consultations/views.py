from django.shortcuts import render
from rest_framework import viewsets, status
from rest_framework.decorators import action
from rest_framework.response import Response
from rest_framework.pagination import PageNumberPagination
from django.db.models import Q
from rest_framework.permissions import IsAuthenticated, DjangoModelPermissions
from core.mixins import CreatedByMixin
from rest_framework.exceptions import PermissionDenied, ValidationError
from drf_spectacular.utils import extend_schema
from .permissions import ConsultationPermission
from .models import Consultation, Group, Appointment, Participant, Message, AppointmentStatus
from django.utils import timezone
from .serializers import (
    ConsultationSerializer, 
    GroupSerializer, 
    AppointmentSerializer,
    ParticipantSerializer,
    MessageSerializer
)

from messaging.tasks import send_message_task


class ConsultationPagination(PageNumberPagination):
    page_size = 20
    page_size_query_param = 'page_size'
    max_page_size = 100


class ConsultationViewSet(CreatedByMixin, viewsets.ModelViewSet):
    serializer_class = ConsultationSerializer
    permission_classes = [ConsultationPermission]
    pagination_class = ConsultationPagination
    filterset_fields = ['group', 'beneficiary', 'created_by', 'owned_by']
    ordering = ['-created_at']
    ordering_fields = ['created_at', 'updated_at', 'closed_at']
    
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
    
    @extend_schema(request=AppointmentSerializer, responses=AppointmentSerializer)
    @action(detail=True, methods=['post'])
    def appointment(self, request, pk=None):
        """Get all appointment for this consultation"""
        consultation = self.get_object()
        serializer = AppointmentSerializer(
            data=request.data,
            context={'request': request, 'consultation': consultation}
        )

        if serializer.is_valid():
            appointment = serializer.save(
                consultation=consultation,
                created_by=request.user
            )

            message_serializer = AppointmentSerializer(appointment)
            response_data = message_serializer.data

            return Response(response_data, status=status.HTTP_201_CREATED)

        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

    @extend_schema(responses=AppointmentSerializer(many=True))
    @action(detail=True, methods=['get'])
    def appointments(self, request, pk=None):
        """Get all appointment for this consultation"""
        consultation = self.get_object()
        appointments = consultation.appointments.all()
        
        page = self.paginate_queryset(appointments)
        if page is not None:
            serializer = AppointmentSerializer(page, many=True)
            return self.get_paginated_response(serializer.data)
        
        serializer = AppointmentSerializer(appointments, many=True)
        return Response(serializer.data)

    @extend_schema(responses=MessageSerializer(many=True))
    @action(detail=True, methods=['get'])
    def messages(self, request, pk=None):
        """Get all messages for this consultation"""
        consultation = self.get_object()
        messages = consultation.messages.all()
        
        page = self.paginate_queryset(messages)
        if page is not None:
            serializer = MessageSerializer(page, many=True)
            return self.get_paginated_response(serializer.data)
        
        serializer = MessageSerializer(messages, many=True)
        return Response(serializer.data)

    @extend_schema(request=MessageSerializer, responses=MessageSerializer)
    @action(detail=True, methods=['post'])
    def message(self, request, pk=None):
        """Send a message for this consultation"""
        consultation = self.get_object()

        serializer = MessageSerializer(
            data=request.data,
            context={'request': request}
        )

        if serializer.is_valid():
            msg = serializer.save(
                consultation=consultation
            )

            return Response(MessageSerializer(msg).data, status=status.HTTP_201_CREATED)

        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

    @extend_schema(responses=AppointmentSerializer)
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
        responses={200: ParticipantSerializer(many=True), 201: ParticipantSerializer}
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

    @extend_schema(responses={204: None})
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

    @extend_schema(responses=AppointmentSerializer)
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

class GroupViewSet(viewsets.ReadOnlyModelViewSet):
    """
    ViewSet for groups - read only
    Users can only see groups they belong to
    """
    serializer_class = GroupSerializer
    permission_classes = [IsAuthenticated]
    
    def get_queryset(self):
        user = self.request.user
        if not user.is_authenticated:
            return Group.objects.none()
        
        return Group.objects.filter(users=user)
