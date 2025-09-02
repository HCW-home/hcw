from django.test import TestCase
from unittest.mock import patch, MagicMock
from datetime import timedelta
from django.utils import timezone

from consultations.models import (
    Consultation, Appointment, Participant, 
    ReasonAssignmentMethod, AppointmentStatus
)
from consultations.assignments import (
    BaseAssignmentHandler, AssignmentResult, get_assignment_handler
)
from consultations.assignments.user import UserAssignmentHandler
from consultations.assignments.queue import QueueAssignmentHandler
from consultations.assignments.appointment import AppointmentAssignmentHandler

from .factories import (
    RequestFactory, UserReasonFactory, QueueReasonFactory, 
    AppointmentReasonFactory, ReasonFactory, DoctorFactory, PatientFactory, 
    BookingSlotFactory, FullWeekBookingSlotFactory, 
    AppointmentFactory, ConsultationFactory
)
from .utils import BaseTestCase, TimeTestMixin


class BaseAssignmentHandlerTests(BaseTestCase):
    
    def setUp(self):
        super().setUp()
        self.patient = PatientFactory()
        self.reason = UserReasonFactory()
        self.request = RequestFactory(
            created_by=self.patient,
            reason=self.reason
        )
    
    def test_assignment_result_structure(self):
        """Test AssignmentResult structure"""
        consultation = ConsultationFactory()
        appointment = AppointmentFactory()
        
        # Success result
        result = AssignmentResult(
            success=True,
            consultation=consultation,
            appointment=appointment
        )
        
        self.assertTrue(result.success)
        self.assertEqual(result.consultation, consultation)
        self.assertEqual(result.appointment, appointment)
        self.assertIsNone(result.error_message)
        
        # Error result
        result = AssignmentResult(
            success=False,
            error_message="Test error"
        )
        
        self.assertFalse(result.success)
        self.assertIsNone(result.consultation)
        self.assertIsNone(result.appointment)
        self.assertEqual(result.error_message, "Test error")
    
    def test_base_handler_create_consultation(self):
        """Test base handler _create_consultation method"""
        handler = UserAssignmentHandler(self.request)
        consultation = handler._create_consultation()
        
        self.assertEqual(consultation.created_by, self.request.created_by)
        self.assertEqual(consultation.beneficiary, self.request.created_by)  # Default beneficiary
        self.assertIn(self.request.reason.name, consultation.title)
        self.assertEqual(consultation.description, self.request.comment)
    
    def test_base_handler_create_participants(self):
        """Test base handler _create_participants method"""
        doctor = DoctorFactory()
        consultation = ConsultationFactory()
        appointment = AppointmentFactory(consultation=consultation)
        
        handler = UserAssignmentHandler(self.request)
        handler._create_participants(appointment, doctor)
        
        participants = appointment.participant_set.all()
        self.assertEqual(participants.count(), 2)
        
        participant_users = [p.user for p in participants]
        self.assertIn(self.request.created_by, participant_users)
        self.assertIn(doctor, participant_users)


class UserAssignmentHandlerTests(BaseTestCase):
    
    def setUp(self):
        super().setUp()
        self.patient = PatientFactory()
        self.doctor = DoctorFactory()
        self.reason = UserReasonFactory(user_assignee=self.doctor)
        self.request = RequestFactory(
            created_by=self.patient,
            reason=self.reason
        )
    
    def test_user_assignment_success(self):
        """Test successful user assignment"""
        handler = UserAssignmentHandler(self.request)
        result = handler.process()
        
        self.assertTrue(result.success)
        self.assertIsNotNone(result.consultation)
        self.assertIsNone(result.appointment)  # User assignment doesn't create appointment
        self.assertIsNone(result.error_message)
        
        # Check consultation properties
        consultation = result.consultation
        self.assertEqual(consultation.owned_by, self.doctor)
        self.assertIsNone(consultation.group)
        self.assertEqual(consultation.created_by, self.patient)
        self.assertEqual(consultation.beneficiary, self.patient)
    
    def test_user_assignment_missing_user_assignee(self):
        """Test user assignment with missing user_assignee"""
        reason = UserReasonFactory(user_assignee=None)
        request = RequestFactory(reason=reason)
        
        handler = UserAssignmentHandler(request)
        result = handler.process()
        
        self.assertFalse(result.success)
        self.assertIsNone(result.consultation)
        self.assertIn("user_assignee", result.error_message)
    
    def test_user_assignment_handles_exceptions(self):
        """Test user assignment handles unexpected exceptions"""
        handler = UserAssignmentHandler(self.request)
        
        with patch.object(handler, '_create_consultation', side_effect=Exception("Test error")):
            result = handler.process()
        
        self.assertFalse(result.success)
        self.assertIn("Test error", result.error_message)


class QueueAssignmentHandlerTests(BaseTestCase):
    
    def setUp(self):
        super().setUp()
        self.patient = PatientFactory()
        from .factories import QueueFactory
        self.queue = QueueFactory()
        self.reason = QueueReasonFactory(queue_assignee=self.queue)
        self.request = RequestFactory(
            created_by=self.patient,
            reason=self.reason
        )
    
    def test_queue_assignment_success(self):
        """Test successful queue assignment"""
        handler = QueueAssignmentHandler(self.request)
        result = handler.process()
        
        self.assertTrue(result.success)
        self.assertIsNotNone(result.consultation)
        self.assertIsNone(result.appointment)  # Queue assignment doesn't create appointment
        self.assertIsNone(result.error_message)
        
        # Check consultation properties
        consultation = result.consultation
        self.assertEqual(consultation.group, self.queue)
        self.assertIsNone(consultation.owned_by)
        self.assertEqual(consultation.created_by, self.patient)
        self.assertEqual(consultation.beneficiary, self.patient)
    
    def test_queue_assignment_missing_queue_assignee(self):
        """Test queue assignment with missing queue_assignee"""
        reason = QueueReasonFactory(queue_assignee=None)
        request = RequestFactory(reason=reason)
        
        handler = QueueAssignmentHandler(request)
        result = handler.process()
        
        self.assertFalse(result.success)
        self.assertIsNone(result.consultation)
        self.assertIn("queue_assignee", result.error_message)


class AppointmentAssignmentHandlerTests(BaseTestCase, TimeTestMixin):
    
    def setUp(self):
        super().setUp()
        self.patient = PatientFactory()
        self.doctor = DoctorFactory()
        self.reason = AppointmentReasonFactory(duration=30)
        
        # Add doctor to reason's speciality
        self.doctor.specialities.add(self.reason.speciality)
        
        # Create booking slot for next Monday 10:00
        self.booking_slot = FullWeekBookingSlotFactory(
            user=self.doctor,
            start_time=timezone.now().time().replace(hour=9, minute=0),
            end_time=timezone.now().time().replace(hour=17, minute=0)
        )
        
        # Request for next Monday at 10:00
        self.expected_time = self.create_datetime_on_day(0, 10, 0)  # Monday 10:00
        self.request = RequestFactory(
            created_by=self.patient,
            reason=self.reason,
            expected_at=self.expected_time
        )
    
    def test_appointment_assignment_with_available_doctor(self):
        """Test successful appointment assignment with available doctor"""
        handler = AppointmentAssignmentHandler(self.request)
        result = handler.process()
        
        self.assertTrue(result.success)
        self.assertIsNotNone(result.consultation)
        self.assertIsNotNone(result.appointment)
        self.assertIsNone(result.error_message)
        
        # Check consultation properties
        consultation = result.consultation
        self.assertEqual(consultation.owned_by, self.doctor)
        self.assertEqual(consultation.created_by, self.patient)
        
        # Check appointment properties
        appointment = result.appointment
        self.assertEqual(appointment.consultation, consultation)
        self.assertEqual(appointment.scheduled_at, self.expected_time)
        self.assertEqual(appointment.status, AppointmentStatus.SCHEDULED)
        
        # Check participants were created
        participants = appointment.participant_set.all()
        self.assertEqual(participants.count(), 2)
        participant_users = [p.user for p in participants]
        self.assertIn(self.patient, participant_users)
        self.assertIn(self.doctor, participant_users)
    
    def test_appointment_assignment_with_specific_doctor(self):
        """Test appointment assignment with specific expected doctor"""
        self.request.expected_with = self.doctor
        self.request.save()
        
        handler = AppointmentAssignmentHandler(self.request)
        result = handler.process()
        
        self.assertTrue(result.success)
        self.assertEqual(result.consultation.owned_by, self.doctor)
    
    def test_appointment_assignment_no_available_doctors(self):
        """Test appointment assignment when no doctors available"""
        # Remove doctor from speciality
        self.doctor.specialities.clear()
        
        handler = AppointmentAssignmentHandler(self.request)
        result = handler.process()
        
        self.assertFalse(result.success)
        self.assertIsNone(result.consultation)
        self.assertIn("No available doctors", result.error_message)
    
    def test_appointment_assignment_doctor_not_available_at_time(self):
        """Test appointment assignment when doctor not available at requested time"""
        # Request outside booking slot hours (18:00)
        self.request.expected_at = self.create_datetime_on_day(0, 18, 0)
        self.request.save()
        
        handler = AppointmentAssignmentHandler(self.request)
        result = handler.process()
        
        self.assertFalse(result.success)
        self.assertIn("No available doctors", result.error_message)
    
    def test_appointment_assignment_with_conflict(self):
        """Test appointment assignment when doctor has conflicting appointment"""
        # Create conflicting appointment
        consultation = ConsultationFactory(owned_by=self.doctor)
        AppointmentFactory(
            consultation=consultation,
            scheduled_at=self.expected_time,
            end_expected_at=self.expected_time + timedelta(minutes=30),
            status=AppointmentStatus.SCHEDULED
        )
        
        handler = AppointmentAssignmentHandler(self.request)
        result = handler.process()
        
        self.assertFalse(result.success)
        self.assertIn("No available doctors", result.error_message)
    
    def test_appointment_assignment_selects_doctor_with_fewest_appointments(self):
        """Test appointment assignment selects doctor with fewest appointments"""
        # Create second doctor with same speciality
        doctor2 = DoctorFactory()
        doctor2.specialities.add(self.reason.speciality)
        
        # Create booking slot for second doctor
        FullWeekBookingSlotFactory(
            user=doctor2,
            start_time=timezone.now().time().replace(hour=9, minute=0),
            end_time=timezone.now().time().replace(hour=17, minute=0)
        )
        
        # Give first doctor more appointments on the same day
        consultation1 = ConsultationFactory(owned_by=self.doctor)
        AppointmentFactory(
            consultation=consultation1,
            scheduled_at=self.expected_time - timedelta(hours=2),
            status=AppointmentStatus.SCHEDULED
        )
        
        handler = AppointmentAssignmentHandler(self.request)
        result = handler.process()
        
        self.assertTrue(result.success)
        # Should select doctor2 who has fewer appointments
        self.assertEqual(result.consultation.owned_by, doctor2)
    
    def test_is_day_enabled_logic(self):
        """Test day-of-week enablement logic"""
        handler = AppointmentAssignmentHandler(self.request)
        
        # Test all days
        self.assertTrue(handler._is_day_enabled(self.booking_slot, 0))  # Monday
        self.assertTrue(handler._is_day_enabled(self.booking_slot, 1))  # Tuesday
        self.assertTrue(handler._is_day_enabled(self.booking_slot, 2))  # Wednesday
        self.assertTrue(handler._is_day_enabled(self.booking_slot, 3))  # Thursday
        self.assertTrue(handler._is_day_enabled(self.booking_slot, 4))  # Friday
        self.assertTrue(handler._is_day_enabled(self.booking_slot, 5))  # Saturday
        self.assertTrue(handler._is_day_enabled(self.booking_slot, 6))  # Sunday
    
    def test_booking_slot_break_time_handling(self):
        """Test booking slot break time is respected"""
        # Request during break time (12:00-14:00)
        self.request.expected_at = self.create_datetime_on_day(0, 12, 30)
        self.request.save()
        
        handler = AppointmentAssignmentHandler(self.request)
        result = handler.process()
        
        self.assertFalse(result.success)
        self.assertIn("No available doctors", result.error_message)


class AssignmentFactoryTests(BaseTestCase):
    
    def test_get_assignment_handler_user_method(self):
        """Test factory returns UserAssignmentHandler for USER method"""
        reason = UserReasonFactory()
        request = RequestFactory(reason=reason)
        
        handler = get_assignment_handler(request)
        
        self.assertIsInstance(handler, UserAssignmentHandler)
        self.assertEqual(handler.request, request)
    
    def test_get_assignment_handler_queue_method(self):
        """Test factory returns QueueAssignmentHandler for QUEUE method"""
        reason = QueueReasonFactory()
        request = RequestFactory(reason=reason)
        
        handler = get_assignment_handler(request)
        
        self.assertIsInstance(handler, QueueAssignmentHandler)
        self.assertEqual(handler.request, request)
    
    def test_get_assignment_handler_appointment_method(self):
        """Test factory returns AppointmentAssignmentHandler for APPOINTMENT method"""
        reason = AppointmentReasonFactory()
        request = RequestFactory(reason=reason)
        
        handler = get_assignment_handler(request)
        
        self.assertIsInstance(handler, AppointmentAssignmentHandler)
        self.assertEqual(handler.request, request)
    
    def test_get_assignment_handler_unknown_method(self):
        """Test factory raises error for unknown assignment method"""
        reason = ReasonFactory()
        reason.assignment_method = "UNKNOWN"
        request = RequestFactory(reason=reason)
        
        with self.assertRaises(ValueError) as context:
            get_assignment_handler(request)
        
        self.assertIn("Unknown assignment method", str(context.exception))