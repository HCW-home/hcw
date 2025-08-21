from django.shortcuts import render
from rest_framework import viewsets, status
from rest_framework.decorators import action
from rest_framework.response import Response
from django.db.models import Q
from rest_framework.permissions import IsAuthenticated, DjangoModelPermissions
from .permissions import ConsultationPermission
from .models import Consultation, Group, Appointment, Participant, Message
from .serializers import (
    ConsultationSerializer, 
    ConsultationCreateSerializer,
    GroupSerializer, 
    AppointmentSerializer,
    ParticipantSerializer,
    MessageSerializer,
    MessageCreateSerializer
)
from .services import MessagingService
from .tasks import send_message_task


class ConsultationViewSet(viewsets.ModelViewSet):
    serializer_class = ConsultationSerializer
    permission_classes = [ConsultationPermission]
    
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
    
    def get_serializer_class(self):
        if self.action == 'create':
            return ConsultationCreateSerializer
        return ConsultationSerializer
    
    def perform_create(self, serializer):
        # The logged-in user becomes the creator and owner
        consultation = serializer.save(
            created_by=self.request.user,
            owned_by=self.request.user
        )
        
        # If a group is specified, set it
        group_id = serializer.validated_data.get('group_id')
        if group_id:
            try:
                group = Group.objects.get(id=group_id)
                if self.request.user in group.users.all():
                    consultation.group = group
                    consultation.save()
            except Group.DoesNotExist:
                pass
    
    @action(detail=True, methods=['post'])
    def close(self, request, pk=None):
        """Close a consultation"""
        consultation = self.get_object()
        if consultation.closed_at is not None:
            return Response(
                {'error': 'This consultation is already closed'}, 
                status=status.HTTP_400_BAD_REQUEST
            )
        
        from django.utils import timezone
        consultation.closed_at = timezone.now()
        consultation.save()
        
        serializer = self.get_serializer(consultation)
        return Response(serializer.data)
    
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
    
    @action(detail=True, methods=['post'])
    def send_message(self, request, pk=None):
        """Send a message for this consultation"""
        consultation = self.get_object()
        
        # Create message serializer with consultation context
        serializer = MessageCreateSerializer(
            data=request.data,
            context={'request': request, 'consultation': consultation}
        )
        
        if serializer.is_valid():
            # Create the message
            message = serializer.save(
                consultation=consultation,
                sent_by=request.user
            )
            
            # Set participant if provided
            participant_id = serializer.validated_data.get('participant_id')
            if participant_id:
                try:
                    participant = Participant.objects.get(
                        id=participant_id,
                        appointement__consultation=consultation
                    )
                    message.participant = participant
                    message.save()
                except Participant.DoesNotExist:
                    pass
            
            # Queue the message for sending via Celery
            task = send_message_task.delay(message.id)
            message.celery_task_id = task.id
            message.save()
            
            # Return message with task info
            message_serializer = MessageSerializer(message)
            response_data = message_serializer.data
            response_data['celery_task_id'] = task.id
            response_data['status'] = 'queued'
            
            return Response(response_data, status=status.HTTP_201_CREATED)
        
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)
    
    @action(detail=True, methods=['get'])
    def messages(self, request, pk=None):
        """Get all messages for this consultation"""
        consultation = self.get_object()
        messages = consultation.messages.all()
        serializer = MessageSerializer(messages, many=True)
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

class AppointmentViewSet(viewsets.ModelViewSet):
    """
    ViewSet for appointments
    Users can view/modify appointments from consultations they have access to
    """
    serializer_class = AppointmentSerializer
    permission_classes = [IsAuthenticated]
    
    def get_queryset(self):
        user = self.request.user
        if not user.is_authenticated:
            return Appointment.objects.none()
        
        # Appointments from consultations accessible to the user
        accessible_consultations = Consultation.objects.filter(
            Q(created_by=user) | 
            Q(owned_by=user) |
            Q(group__users=user)
        ).distinct()
        
        return Appointment.objects.filter(consultation__in=accessible_consultations)
    
    def perform_create(self, serializer):
        consultation_id = self.request.data.get('consultation')
        if consultation_id:
            try:
                consultation = Consultation.objects.get(id=consultation_id)
                # Check that the user has access to this consultation
                user = self.request.user
                if (consultation.created_by == user or 
                    consultation.owned_by == user or 
                    (consultation.group and user in consultation.group.users.all())):
                    serializer.save(consultation=consultation)
                else:
                    from rest_framework.exceptions import PermissionDenied
                    raise PermissionDenied("You don't have access to this consultation")
            except Consultation.DoesNotExist:
                from rest_framework.exceptions import ValidationError
                raise ValidationError("This consultation does not exist")

class ParticipantViewSet(viewsets.ModelViewSet):
    """
    ViewSet for participants
    """
    serializer_class = ParticipantSerializer
    permission_classes = [IsAuthenticated]
    
    def get_queryset(self):
        user = self.request.user
        if not user.is_authenticated:
            return Participant.objects.none()
        
        # Participants of appointments from accessible consultations
        accessible_consultations = Consultation.objects.filter(
            Q(created_by=user) | 
            Q(owned_by=user) |
            Q(group__users=user)
        ).distinct()
        
        accessible_appointments = Appointment.objects.filter(
            consultation__in=accessible_consultations
        )
        
        return Participant.objects.filter(appointement__in=accessible_appointments)

class MessageViewSet(viewsets.ModelViewSet):
    """
    ViewSet for messages
    Users can view/modify messages from consultations they have access to
    """
    serializer_class = MessageSerializer
    permission_classes = [IsAuthenticated]
    
    def get_queryset(self):
        user = self.request.user
        if not user.is_authenticated:
            return Message.objects.none()
        
        # Messages from consultations accessible to the user
        accessible_consultations = Consultation.objects.filter(
            Q(created_by=user) | 
            Q(owned_by=user) |
            Q(group__users=user)
        ).distinct()
        
        return Message.objects.filter(consultation__in=accessible_consultations)
    
    def get_serializer_class(self):
        if self.action == 'create':
            return MessageCreateSerializer
        return MessageSerializer
    
    def perform_create(self, serializer):
        consultation_id = self.request.data.get('consultation')
        if consultation_id:
            try:
                consultation = Consultation.objects.get(id=consultation_id)
                # Check that the user has access to this consultation
                user = self.request.user
                if (consultation.created_by == user or 
                    consultation.owned_by == user or 
                    (consultation.group and user in consultation.group.users.all())):
                    
                    message = serializer.save(
                        consultation=consultation,
                        sent_by=user
                    )
                    
                    # Queue the message for sending via Celery
                    task = send_message_task.delay(message.id)
                    message.celery_task_id = task.id
                    message.save()
                else:
                    from rest_framework.exceptions import PermissionDenied
                    raise PermissionDenied("You don't have access to this consultation")
            except Consultation.DoesNotExist:
                from rest_framework.exceptions import ValidationError
                raise ValidationError("This consultation does not exist")
    
    @action(detail=True, methods=['post'])
    def resend(self, request, pk=None):
        """Resend a failed message"""
        message = self.get_object()
        
        if message.status not in ['failed', 'pending']:
            return Response(
                {'error': 'Only failed or pending messages can be resent'}, 
                status=status.HTTP_400_BAD_REQUEST
            )
        
        # Reset message status to pending
        message.status = 'pending'
        message.error_message = ''
        message.save()
        
        # Queue the message for resending via Celery
        task = send_message_task.delay(message.id)
        message.celery_task_id = task.id
        message.save()
        
        # Return updated message with task info
        serializer = self.get_serializer(message)
        response_data = serializer.data
        response_data['celery_task_id'] = task.id
        response_data['status'] = 'queued_for_retry'
        
        return Response(response_data)
    
    @action(detail=True, methods=['post'])
    def mark_delivered(self, request, pk=None):
        """Mark message as delivered (webhook endpoint)"""
        message = self.get_object()
        message.mark_as_delivered()
        
        serializer = self.get_serializer(message)
        return Response(serializer.data)
    
    @action(detail=True, methods=['post'])
    def mark_read(self, request, pk=None):
        """Mark message as read"""
        message = self.get_object()
        message.mark_as_read()
        
        serializer = self.get_serializer(message)
        return Response(serializer.data)
