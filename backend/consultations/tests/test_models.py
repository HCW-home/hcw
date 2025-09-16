from django.test import TestCase
from django.core.exceptions import ValidationError
from django.contrib.auth import get_user_model
from datetime import time, datetime, timedelta
from django.utils import timezone

from consultations.models import (
    Queue, Consultation, Reason, Request, Appointment, 
    Participant, BookingSlot, ReasonAssignmentMethod, 
    RequestStatus, AppointmentStatus, Type
)
from .factories import (
    QueueFactory, ConsultationFactory, ReasonFactory, 
    RequestFactory, AppointmentFactory, ParticipantFactory, 
    BookingSlotFactory, UserFactory, DoctorFactory, 
    PatientFactory, SpecialityFactory, UserReasonFactory,
    QueueReasonFactory, AppointmentReasonFactory
)
from .utils import BaseTestCase

User = get_user_model()


class QueueModelTests(BaseTestCase):
    
    def test_queue_creation(self):
        """Test basic queue creation"""
        queue = QueueFactory(name="Cardiology Queue")
        self.assertEqual(queue.name, "Cardiology Queue")
        self.assertEqual(str(queue), "Cardiology Queue")
    
    def test_queue_users_relationship(self):
        """Test queue users many-to-many relationship"""
        queue = QueueFactory()
        user1 = DoctorFactory()
        user2 = DoctorFactory()
        
        queue.users.add(user1, user2)
        
        self.assertEqual(queue.users.count(), 2)
        self.assertIn(user1, queue.users.all())
        self.assertIn(user2, queue.users.all())
    
    def test_queue_organisation_relationship(self):
        """Test queue organisation many-to-many relationship"""
        queue = QueueFactory()
        # Note: We'd need to import OrganisationFactory from users app
        # For now, just test the relationship exists
        self.assertTrue(hasattr(queue, 'organisation'))


class ConsultationModelTests(BaseTestCase):
    
    def test_consultation_creation(self):
        """Test basic consultation creation"""
        doctor = DoctorFactory()
        patient = PatientFactory()
        consultation = ConsultationFactory(
            title="Test Consultation",
            description="Test Description",
            owned_by=doctor,
            beneficiary=patient
        )
        
        self.assertEqual(consultation.title, "Test Consultation")
        self.assertEqual(consultation.description, "Test Description")
        self.assertEqual(consultation.owned_by, doctor)
        self.assertEqual(consultation.beneficiary, patient)
        self.assertIsNone(consultation.closed_at)
    
    def test_consultation_string_representation(self):
        """Test consultation string representation"""
        consultation = ConsultationFactory()
        expected_str = f"Consultation #{consultation.pk}"
        self.assertEqual(str(consultation), expected_str)
    
    def test_consultation_timestamps(self):
        """Test consultation created_at and updated_at timestamps"""
        consultation = ConsultationFactory()
        
        self.assertIsNotNone(consultation.created_at)
        self.assertIsNotNone(consultation.updated_at)
        
        # Update consultation and check updated_at changes
        old_updated_at = consultation.updated_at
        consultation.title = "Updated Title"
        consultation.save()
        
        self.assertGreater(consultation.updated_at, old_updated_at)
    
    def test_consultation_closed_at_functionality(self):
        """Test consultation closing functionality"""
        consultation = ConsultationFactory()
        self.assertIsNone(consultation.closed_at)
        
        # Close consultation
        consultation.closed_at = timezone.now()
        consultation.save()
        
        self.assertIsNotNone(consultation.closed_at)


class ReasonModelTests(BaseTestCase):
    
    def test_reason_creation(self):
        """Test basic reason creation"""
        speciality = SpecialityFactory()
        reason = ReasonFactory(
            name="General Consultation",
            speciality=speciality,
            duration=30,
            assignment_method=ReasonAssignmentMethod.APPOINTMENT
        )
        
        self.assertEqual(reason.name, "General Consultation")
        self.assertEqual(reason.speciality, speciality)
        self.assertEqual(reason.duration, 30)
        self.assertEqual(reason.assignment_method, ReasonAssignmentMethod.APPOINTMENT)
        self.assertTrue(reason.is_active)
    
    def test_user_assignment_method_validation(self):
        """Test USER assignment method validation"""
        doctor = DoctorFactory()
        queue = QueueFactory()
        
        # Valid USER assignment
        reason = UserReasonFactory(user_assignee=doctor)
        reason.full_clean()  # Should not raise
        
        # Invalid: USER method with queue_assignee
        reason = ReasonFactory(
            assignment_method=ReasonAssignmentMethod.USER,
            user_assignee=doctor,
            queue_assignee=queue
        )
        with self.assertRaises(ValidationError):
            reason.full_clean()
        
        # Invalid: USER method without user_assignee
        reason = ReasonFactory(
            assignment_method=ReasonAssignmentMethod.USER,
            user_assignee=None
        )
        with self.assertRaises(ValidationError):
            reason.full_clean()
    
    def test_queue_assignment_method_validation(self):
        """Test QUEUE assignment method validation"""
        doctor = DoctorFactory()
        queue = QueueFactory()
        
        # Valid QUEUE assignment
        reason = QueueReasonFactory(queue_assignee=queue)
        reason.full_clean()  # Should not raise
        
        # Invalid: QUEUE method with user_assignee
        reason = ReasonFactory(
            assignment_method=ReasonAssignmentMethod.QUEUE,
            queue_assignee=queue,
            user_assignee=doctor
        )
        with self.assertRaises(ValidationError):
            reason.full_clean()
        
        # Invalid: QUEUE method without queue_assignee
        reason = ReasonFactory(
            assignment_method=ReasonAssignmentMethod.QUEUE,
            queue_assignee=None
        )
        with self.assertRaises(ValidationError):
            reason.full_clean()
    
    def test_appointment_assignment_method_validation(self):
        """Test APPOINTMENT assignment method validation"""
        doctor = DoctorFactory()
        queue = QueueFactory()
        
        # Valid APPOINTMENT assignment
        reason = AppointmentReasonFactory()
        reason.full_clean()  # Should not raise
        
        # Invalid: APPOINTMENT method with user_assignee
        reason = ReasonFactory(
            assignment_method=ReasonAssignmentMethod.APPOINTMENT,
            user_assignee=doctor
        )
        with self.assertRaises(ValidationError):
            reason.full_clean()
        
        # Invalid: APPOINTMENT method with queue_assignee
        reason = ReasonFactory(
            assignment_method=ReasonAssignmentMethod.APPOINTMENT,
            queue_assignee=queue
        )
        with self.assertRaises(ValidationError):
            reason.full_clean()


class RequestModelTests(BaseTestCase):
    
    def test_request_creation(self):
        """Test basic request creation"""
        patient = PatientFactory()
        reason = ReasonFactory()
        expected_time = timezone.now() + timedelta(days=1)
        
        request = RequestFactory(
            created_by=patient,
            beneficiary=patient,
            expected_at=expected_time,
            reason=reason,
            comment="Test request",
            type=Type.ONLINE
        )
        
        self.assertEqual(request.created_by, patient)
        self.assertEqual(request.beneficiary, patient)
        self.assertEqual(request.expected_at, expected_time)
        self.assertEqual(request.reason, reason)
        self.assertEqual(request.comment, "Test request")
        self.assertEqual(request.type, Type.ONLINE)
        self.assertEqual(request.status, RequestStatus.REQUESTED)
    
    def test_request_with_expected_doctor(self):
        """Test request with specific expected doctor"""
        patient = PatientFactory()
        doctor = DoctorFactory()
        reason = ReasonFactory()
        
        request = RequestFactory(
            created_by=patient,
            expected_with=doctor,
            reason=reason
        )
        
        self.assertEqual(request.expected_with, doctor)
    
    def test_request_status_choices(self):
        """Test all request status choices"""
        request = RequestFactory()
        
        # Test all status choices
        for status, _ in RequestStatus.choices:
            request.status = status
            request.full_clean()  # Should not raise


class AppointmentModelTests(BaseTestCase):
    
    def test_appointment_creation(self):
        """Test basic appointment creation"""
        consultation = ConsultationFactory()
        scheduled_time = timezone.now() + timedelta(days=1)
        end_time = scheduled_time + timedelta(minutes=30)
        
        appointment = AppointmentFactory(
            consultation=consultation,
            scheduled_at=scheduled_time,
            end_expected_at=end_time,
            type=Type.INPERSON,
            status=AppointmentStatus.SCHEDULED
        )
        
        self.assertEqual(appointment.consultation, consultation)
        self.assertEqual(appointment.scheduled_at, scheduled_time)
        self.assertEqual(appointment.end_expected_at, end_time)
        self.assertEqual(appointment.type, Type.INPERSON)
        self.assertEqual(appointment.status, AppointmentStatus.SCHEDULED)
    
    def test_appointment_consultation_relationship(self):
        """Test appointment belongs to consultation"""
        consultation = ConsultationFactory()
        appointment = AppointmentFactory(consultation=consultation)
        
        self.assertEqual(appointment.consultation, consultation)
        self.assertIn(appointment, consultation.appointments.all())


class ParticipantModelTests(BaseTestCase):
    
    def test_participant_with_user(self):
        """Test participant creation with user"""
        appointment = AppointmentFactory()
        user = UserFactory()
        
        participant = ParticipantFactory(
            appointment=appointment,  # Note: typo in model
            user=user,
            is_invited=True,
            is_confirmed=False
        )
        
        self.assertEqual(participant.appointment, appointment)
        self.assertEqual(participant.user, user)
        self.assertTrue(participant.is_invited)
        self.assertFalse(participant.is_confirmed)
    
    def test_participant_with_email_only(self):
        """Test participant creation with email only"""
        appointment = AppointmentFactory()
        
        participant = ParticipantFactory(
            appointment=appointment,
            user=None,
            email="participant@example.com",
            message_type='email'
        )
        
        self.assertIsNone(participant.user)
        self.assertEqual(participant.email, "participant@example.com")
    
    def test_participant_validation_requires_contact_method(self):
        """Test participant requires at least user, email, or phone"""
        appointment = AppointmentFactory()
        
        # Valid: has user
        participant = Participant(
            appointment=appointment,
            user=UserFactory(),
            auth_token="test-token",
            message_type='email'
        )
        participant.full_clean()  # Should not raise
        
        # Valid: has email
        participant = Participant(
            appointment=appointment,
            email="test@example.com",
            auth_token="test-token",
            message_type='email'
        )
        participant.full_clean()  # Should not raise
        
        # Invalid: no contact method
        participant = Participant(
            appointment=appointment,
            auth_token="test-token",
            message_type='email'
        )
        with self.assertRaises(ValidationError):
            participant.full_clean()
    
    def test_participant_phone_validation(self):
        """Test participant phone number validation"""
        appointment = AppointmentFactory()
        
        # Valid phone numbers
        valid_phones = ['+33123456789', '0033987654321', '+1234567890123']
        for phone in valid_phones:
            participant = Participant(
                appointment=appointment,
                phone=phone,
                auth_token="test-token",
                message_type='sms'
            )
            participant.full_clean()  # Should not raise
        
        # Invalid phone numbers
        invalid_phones = ['123', '++33123456789', 'abc123456789', '+123']
        for phone in invalid_phones:
            participant = Participant(
                appointment=appointment,
                phone=phone,
                auth_token="test-token",
                message_type='sms'
            )
            with self.assertRaises(ValidationError):
                participant.full_clean()


class BookingSlotModelTests(BaseTestCase):
    
    def test_booking_slot_creation(self):
        """Test basic booking slot creation"""
        doctor = DoctorFactory()
        
        slot = BookingSlotFactory(
            user=doctor,
            start_time=time(9, 0),
            end_time=time(17, 0),
            start_break=time(12, 0),
            end_break=time(13, 0),
            monday=True,
            tuesday=True,
            wednesday=False
        )
        
        self.assertEqual(slot.user, doctor)
        self.assertEqual(slot.start_time, time(9, 0))
        self.assertEqual(slot.end_time, time(17, 0))
        self.assertEqual(slot.start_break, time(12, 0))
        self.assertEqual(slot.end_break, time(13, 0))
        self.assertTrue(slot.monday)
        self.assertTrue(slot.tuesday)
        self.assertFalse(slot.wednesday)
    
    def test_booking_slot_no_break_times(self):
        """Test booking slot without break times"""
        slot = BookingSlotFactory(
            start_break=None,
            end_break=None
        )
        
        self.assertIsNone(slot.start_break)
        self.assertIsNone(slot.end_break)
    
    def test_booking_slot_valid_until(self):
        """Test booking slot with valid_until date"""
        future_date = timezone.now().date() + timedelta(days=30)
        slot = BookingSlotFactory(valid_until=future_date)
        
        self.assertEqual(slot.valid_until, future_date)
    
    def test_booking_slot_user_relationship(self):
        """Test booking slot belongs to user"""
        doctor = DoctorFactory()
        slot = BookingSlotFactory(user=doctor)
        
        self.assertEqual(slot.user, doctor)
        self.assertIn(slot, doctor.slots.all())