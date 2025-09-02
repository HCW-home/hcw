from datetime import timedelta
from django.contrib.auth import get_user_model
from . import BaseAssignmentHandler, AssignmentResult

User = get_user_model()


class AppointmentAssignmentHandler(BaseAssignmentHandler):
    """
    Handles APPOINTMENT assignment method.
    Creates consultation and appointment with mandatory doctor assignment.
    """
    
    def process(self):
        """
        Process the appointment request.
        
        Returns:
            AssignmentResult: Result containing consultation, appointment or error
        """
        try:
            # Find available doctor
            doctor = self._find_available_doctor()
            if not doctor:
                return AssignmentResult(
                    success=False,
                    error_message="No available doctors found for the requested time slot"
                )
            
            # Create consultation
            consultation = self._create_consultation()
            
            # Create appointment with assigned doctor
            appointment = self._create_appointment(consultation, doctor)
            
            # Create participants (requester + doctor)
            self._create_participants(appointment, doctor)
            
            return AssignmentResult(
                success=True,
                consultation=consultation,
                appointment=appointment
            )
            
        except Exception as e:
            return AssignmentResult(
                success=False,
                error_message=f"Error processing appointment request: {str(e)}"
            )
    
    def _find_available_doctor(self):
        """
        Find an available doctor for the requested appointment.
        
        Returns:
            User: Available doctor or None if no doctor is available
        """
        from ..models import BookingSlot, Appointment, AppointmentStatus
        
        # If specific doctor is requested
        if self.request.expected_with:
            if self._is_doctor_available(self.request.expected_with):
                return self.request.expected_with
            return None
        
        # Find doctors with the required specialty
        doctors = User.objects.filter(
            specialities=self.request.reason.speciality
        )
        
        if not doctors.exists():
            return None
        
        # Find doctor with fewest appointments on the requested day
        request_date = self.request.expected_at.date()
        
        available_doctors = []
        for doctor in doctors:
            if self._is_doctor_available(doctor):
                # Count appointments on the requested day
                appointment_count = Appointment.objects.filter(
                    consultation__owned_by=doctor,
                    scheduled_at__date=request_date,
                    status=AppointmentStatus.SCHEDULED
                ).count()
                
                available_doctors.append((doctor, appointment_count))
        
        if not available_doctors:
            return None
        
        # Return doctor with fewest appointments
        available_doctors.sort(key=lambda x: x[1])
        return available_doctors[0][0]
    
    def _is_doctor_available(self, doctor):
        """
        Check if a doctor is available at the requested time.
        
        Args:
            doctor: User instance of the doctor
            
        Returns:
            bool: True if doctor is available, False otherwise
        """
        from ..models import BookingSlot, Appointment, AppointmentStatus
        
        requested_datetime = self.request.expected_at
        requested_date = requested_datetime.date()
        requested_time = requested_datetime.time()
        
        # Get doctor's booking slots
        booking_slots = BookingSlot.objects.filter(user=doctor)
        
        # Check if any booking slot covers the requested time
        for slot in booking_slots:
            # Check if slot is valid for the requested date
            if slot.valid_until and slot.valid_until <= requested_date:
                continue
            
            # Check day of week
            weekday = requested_date.weekday()
            day_enabled = self._is_day_enabled(slot, weekday)
            
            if not day_enabled:
                continue
            
            # Check if time is within working hours
            if not (slot.start_time <= requested_time <= slot.end_time):
                continue
            
            # Check break times
            if (slot.start_break and slot.end_break and
                slot.start_break <= requested_time <= slot.end_break):
                continue
            
            # Check for conflicts with existing appointments
            end_time = requested_datetime + timedelta(minutes=self.request.reason.duration)
            
            conflicts = Appointment.objects.filter(
                consultation__owned_by=doctor,
                scheduled_at__lt=end_time,
                end_expected_at__gt=requested_datetime,
                status=AppointmentStatus.SCHEDULED
            ).exists()
            
            if not conflicts:
                return True
        
        return False
    
    def _is_day_enabled(self, slot, weekday):
        """
        Check if a booking slot is enabled for the given weekday.
        
        Args:
            slot: BookingSlot instance
            weekday: Day of week (0=Monday, 6=Sunday)
            
        Returns:
            bool: True if day is enabled
        """
        day_mapping = {
            0: slot.monday,
            1: slot.tuesday,
            2: slot.wednesday,
            3: slot.thursday,
            4: slot.friday,
            5: slot.saturday,
            6: slot.sunday,
        }
        return day_mapping.get(weekday, False)
    
    def _create_appointment(self, consultation, doctor):
        """
        Create an appointment with the assigned doctor.
        
        Args:
            consultation: The consultation instance
            doctor: The assigned doctor user instance
            
        Returns:
            Appointment: The created appointment instance
        """
        from ..models import Appointment, AppointmentStatus
        
        end_time = self.request.expected_at + timedelta(minutes=self.request.reason.duration)
        
        appointment = Appointment.objects.create(
            consultation=consultation,
            scheduled_at=self.request.expected_at,
            end_expected_at=end_time,
            type=self.request.type,
            status=AppointmentStatus.SCHEDULED,
            created_by=self.request.created_by
        )
        
        # Update consultation to be owned by the assigned doctor
        consultation.owned_by = doctor
        consultation.save()
        
        return appointment