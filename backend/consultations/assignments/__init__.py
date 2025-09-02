from abc import ABC, abstractmethod
from django.contrib.auth import get_user_model

User = get_user_model()


class AssignmentResult:
    """Result of an assignment operation"""
    def __init__(self, success=False, consultation=None, appointment=None, error_message=None):
        self.success = success
        self.consultation = consultation
        self.appointment = appointment
        self.error_message = error_message


class BaseAssignmentHandler(ABC):
    """
    Base class for handling different assignment methods.
    Each assignment method should implement this interface.
    """
    
    def __init__(self, request):
        self.request = request
    
    @abstractmethod
    def process(self):
        """
        Process the request based on the assignment method.
        
        Returns:
            AssignmentResult: Result of the assignment operation
        """
        pass
    
    def _create_consultation(self):
        """
        Helper method to create a consultation for the request.
        
        Returns:
            Consultation: The created consultation instance
        """
        from ..models import Consultation
        
        consultation = Consultation.objects.create(
            created_by=self.request.created_by,
            owned_by=self.request.created_by,
            beneficiary=self.request.beneficiary or self.request.created_by,
            title=f"Consultation for {self.request.reason.name}",
            description=self.request.comment or f"Automated consultation creation for reason: {self.request.reason.name}"
        )
        return consultation
    
    def _create_participants(self, appointment, doctor):
        """
        Helper method to create participants for an appointment.
        
        Args:
            appointment: The appointment instance
            doctor: The assigned doctor user instance
        """
        from ..models import Participant
        
        # Create participant for requester
        Participant.objects.create(
            appointement=appointment,  # Note: model has typo 'appointement' instead of 'appointment'
            user=self.request.created_by,
            is_invited=True,
            is_confirmed=False
        )
        
        # Create participant for doctor
        Participant.objects.create(
            appointement=appointment,  # Note: model has typo 'appointement' instead of 'appointment'
            user=doctor,
            is_invited=True,
            is_confirmed=False
        )


def get_assignment_handler(request):
    """
    Factory function to get the appropriate assignment handler based on the request's reason assignment method.
    
    Args:
        request: Request instance
        
    Returns:
        BaseAssignmentHandler: The appropriate assignment handler
        
    Raises:
        ValueError: If assignment method is unknown
    """
    from ..models import ReasonAssignmentMethod
    
    assignment_method = request.reason.assignment_method
    
    if assignment_method == ReasonAssignmentMethod.USER:
        from .user import UserAssignmentHandler
        return UserAssignmentHandler(request)
    elif assignment_method == ReasonAssignmentMethod.QUEUE:
        from .queue import QueueAssignmentHandler
        return QueueAssignmentHandler(request)
    elif assignment_method == ReasonAssignmentMethod.APPOINTMENT:
        from .appointment import AppointmentAssignmentHandler
        return AppointmentAssignmentHandler(request)
    else:
        raise ValueError(f"Unknown assignment method: {assignment_method}")