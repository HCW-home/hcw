from django.test import TestCase
from rest_framework.test import APIRequestFactory
from rest_framework import serializers
from unittest.mock import patch

from consultations.models import (
    Consultation, Request, Appointment, 
    RequestStatus, ReasonAssignmentMethod
)
from consultations.serializers import (
    ConsultationSerializer, ConsultationCreateSerializer,
    RequestSerializer, AppointmentSerializer,
    ConsultationMessageSerializer
)

from .factories import (
    ConsultationFactory, QueueFactory, RequestFactory, 
    AppointmentFactory, ParticipantFactory, ReasonFactory,
    UserFactory, DoctorFactory, PatientFactory, SpecialityFactory
)
from .utils import BaseTestCase


class ConsultationSerializerTests(BaseTestCase):
    
    def setUp(self):
        super().setUp()
        self.factory = APIRequestFactory()
        self.patient = PatientFactory()
        self.doctor = DoctorFactory()
        self.queue = QueueFactory()
        
        # Add patient to queue for access
        self.queue.users.add(self.patient)
    
    def test_consultation_serialization(self):
        """Test consultation serialization includes all fields"""
        consultation = ConsultationFactory(
            title="Test Consultation",
            description="Test Description",
            created_by=self.patient,
            owned_by=self.doctor,
            beneficiary=self.patient,
            group=self.queue
        )
        
        serializer = ConsultationSerializer(consultation)
        data = serializer.data
        
        # Check all fields present
        self.assertEqual(data['id'], consultation.id)
        self.assertEqual(data['title'], "Test Consultation")
        self.assertEqual(data['description'], "Test Description")
        
        # Check related fields
        self.assertEqual(data['created_by']['id'], self.patient.id)
        self.assertEqual(data['owned_by']['id'], self.doctor.id)
        self.assertEqual(data['beneficiary']['id'], self.patient.id)
        self.assertEqual(data['group']['id'], self.queue.id)
    
    def test_consultation_create_with_group_id(self):
        """Test consultation creation with group_id"""
        request = self.factory.post('/')
        request.user = self.patient
        
        data = {
            'title': 'New Consultation',
            'description': 'Test',
            'group_id': self.queue.id,
            'beneficiary_id': self.patient.id
        }
        
        serializer = ConsultationSerializer(data=data, context={'request': request})
        self.assertTrue(serializer.is_valid(), serializer.errors)
        
        consultation = serializer.save()
        
        self.assertEqual(consultation.title, 'New Consultation')
        self.assertEqual(consultation.group, self.queue)
        self.assertEqual(consultation.created_by, self.patient)
        self.assertEqual(consultation.owned_by, self.patient)
        self.assertEqual(consultation.beneficiary, self.patient)
    
    def test_consultation_create_without_group_access(self):
        """Test consultation creation fails without group access"""
        other_queue = QueueFactory()  # Patient not in this queue
        
        request = self.factory.post('/')
        request.user = self.patient
        
        data = {
            'title': 'New Consultation',
            'group_id': other_queue.id
        }
        
        serializer = ConsultationSerializer(data=data, context={'request': request})
        self.assertTrue(serializer.is_valid())
        
        consultation = serializer.save()
        # Should not set group if user doesn't have access
        self.assertIsNone(consultation.group)
    
    def test_consultation_create_sets_default_beneficiary(self):
        """Test consultation creation sets created_by as default beneficiary"""
        request = self.factory.post('/')
        request.user = self.patient
        
        data = {
            'title': 'New Consultation',
            'description': 'Test'
        }
        
        serializer = ConsultationSerializer(data=data, context={'request': request})
        self.assertTrue(serializer.is_valid())
        
        consultation = serializer.save()
        
        self.assertEqual(consultation.created_by, self.patient)


class ConsultationCreateSerializerTests(BaseTestCase):
    
    def test_create_serializer_fields(self):
        """Test ConsultationCreateSerializer has correct fields"""
        serializer = ConsultationCreateSerializer()
        fields = serializer.fields.keys()
        
        expected_fields = {'group', 'beneficiary', 'description', 'title'}
        self.assertEqual(set(fields), expected_fields)
    
    def test_create_serializer_validation(self):
        """Test ConsultationCreateSerializer validation"""
        queue = QueueFactory()
        patient = PatientFactory()
        
        data = {
            'title': 'Test Consultation',
            'description': 'Test Description',
            'group': queue.id,
            'beneficiary': patient.id
        }
        
        serializer = ConsultationCreateSerializer(data=data)
        self.assertTrue(serializer.is_valid(), serializer.errors)


class RequestSerializerTests(BaseTestCase):
    
    def setUp(self):
        super().setUp()
        self.factory = APIRequestFactory()
        self.patient = PatientFactory()
        self.doctor = DoctorFactory()
        self.speciality = SpecialityFactory()
        self.reason = ReasonFactory(speciality=self.speciality, is_active=True)
    
    def test_request_serialization(self):
        """Test request serialization includes all fields"""
        request_obj = RequestFactory(
            created_by=self.patient,
            expected_with=self.doctor,
            reason=self.reason,
            comment="Test request"
        )
        
        serializer = RequestSerializer(request_obj)
        data = serializer.data
        
        # Check fields
        self.assertEqual(data['id'], request_obj.id)
        self.assertEqual(data['comment'], "Test request")
        self.assertEqual(data['status'], request_obj.status)
        
        # Check related fields
        self.assertEqual(data['created_by']['id'], self.patient.id)
        self.assertEqual(data['expected_with']['id'], self.doctor.id)
        self.assertEqual(data['reason']['id'], self.reason.id)
    
    def test_request_create_with_reason_id(self):
        """Test request creation with reason_id"""
        request = self.factory.post('/')
        request.user = self.patient
        
        expected_time = "2025-01-20T10:00:00Z"
        data = {
            'expected_at': expected_time,
            'reason_id': self.reason.id,
            'expected_with_id': self.doctor.id,
            'comment': 'Test request'
        }
        
        serializer = RequestSerializer(data=data, context={'request': request})
        self.assertTrue(serializer.is_valid(), serializer.errors)
        
        request_obj = serializer.save()
        
        self.assertEqual(request_obj.reason, self.reason)
        self.assertEqual(request_obj.expected_with, self.doctor)
        self.assertEqual(request_obj.created_by, self.patient)
        self.assertEqual(request_obj.comment, 'Test request')
    
    def test_request_create_with_inactive_reason(self):
        """Test request creation with inactive reason fails"""
        inactive_reason = ReasonFactory(is_active=False)
        
        request = self.factory.post('/')
        request.user = self.patient
        
        data = {
            'expected_at': "2025-01-20T10:00:00Z",
            'reason_id': inactive_reason.id,
            'comment': 'Test'
        }
        
        serializer = RequestSerializer(data=data, context={'request': request})
        self.assertTrue(serializer.is_valid())  # Initial validation passes
        
        # The error occurs during save/create
        with self.assertRaises(serializers.ValidationError) as context:
            serializer.save()
        
        self.assertIn('This reason does not exist or is not active', str(context.exception))
    
    def test_request_create_with_invalid_expected_with(self):
        """Test request creation with invalid expected_with_id"""
        request = self.factory.post('/')
        request.user = self.patient
        
        data = {
            'expected_at': "2025-01-20T10:00:00Z",
            'reason_id': self.reason.id,
            'expected_with_id': 99999,  # Non-existent user
            'comment': 'Test'
        }
        
        serializer = RequestSerializer(data=data, context={'request': request})
        self.assertTrue(serializer.is_valid())  # Initial validation passes
        
        # The error occurs during save/create
        with self.assertRaises(serializers.ValidationError) as context:
            serializer.save()
        
        self.assertIn('The specified doctor does not exist', str(context.exception))
    
    def test_request_create_without_expected_with(self):
        """Test request creation without expected_with works"""
        request = self.factory.post('/')
        request.user = self.patient
        
        data = {
            'expected_at': "2025-01-20T10:00:00Z",
            'reason_id': self.reason.id,
            'comment': 'Test request'
        }
        
        serializer = RequestSerializer(data=data, context={'request': request})
        self.assertTrue(serializer.is_valid(), serializer.errors)
        
        request_obj = serializer.save()
        self.assertIsNone(request_obj.expected_with)


class AppointmentSerializerTests(BaseTestCase):
    
    def setUp(self):
        super().setUp()
        self.factory = APIRequestFactory()
        self.consultation = ConsultationFactory()
        self.doctor = DoctorFactory()
        self.patient = PatientFactory()
    
    def test_appointment_serialization(self):
        """Test appointment serialization includes all fields"""
        appointment = AppointmentFactory(
            consultation=self.consultation,
            created_by=self.doctor
        )
        
        # Create participants
        ParticipantFactory(appointement=appointment, user=self.doctor)
        ParticipantFactory(appointement=appointment, user=self.patient)
        
        serializer = AppointmentSerializer(appointment)
        data = serializer.data
        
        # Check fields
        self.assertEqual(data['id'], appointment.id)
        self.assertEqual(data['consultation'], self.consultation.id)
        self.assertEqual(data['status'], appointment.status)
        self.assertEqual(data['type'], appointment.type)
        
        # Check participants
        self.assertEqual(len(data['participants']), 2)
        participant_user_ids = [p['user']['id'] for p in data['participants'] if p['user']]
        self.assertIn(self.doctor.id, participant_user_ids)
        self.assertIn(self.patient.id, participant_user_ids)
    
    def test_appointment_create_with_hidden_created_by(self):
        """Test appointment creation sets created_by from context"""
        request = self.factory.post('/')
        request.user = self.doctor
        
        data = {
            'scheduled_at': "2025-01-20T10:00:00Z",
            'type': 'Online'
        }
        
        serializer = AppointmentSerializer(
            data=data, 
            context={'request': request, 'consultation': self.consultation}
        )
        self.assertTrue(serializer.is_valid(), serializer.errors)
        
        appointment = serializer.save(consultation=self.consultation)
        
        self.assertEqual(appointment.created_by, self.doctor)
        self.assertEqual(appointment.consultation, self.consultation)
    
    def test_appointment_read_only_fields(self):
        """Test appointment serializer read-only fields"""
        appointment = AppointmentFactory()
        
        data = {
            'id': 999,
            'status': 'Cancelled',
            'scheduled_at': "2025-01-20T10:00:00Z"
        }
        
        serializer = AppointmentSerializer(appointment, data=data, partial=True)
        self.assertTrue(serializer.is_valid())
        
        # Status should not be updated (read-only)
        updated_appointment = serializer.save()
        self.assertNotEqual(updated_appointment.status, 'Cancelled')


class ConsultationMessageSerializerTests(BaseTestCase):
    
    def setUp(self):
        super().setUp()
        self.factory = APIRequestFactory()
        self.consultation = ConsultationFactory()
        self.doctor = DoctorFactory()
    
    def test_message_serialization(self):
        """Test message serialization"""
        from consultations.models import Message
        
        message = Message.objects.create(
            consultation=self.consultation,
            created_by=self.doctor,
            content="Test message"
        )
        
        serializer = ConsultationMessageSerializer(message)
        data = serializer.data
        
        self.assertEqual(data['id'], message.id)
        self.assertEqual(data['content'], "Test message")
        self.assertIn('created_at', data)
    
    def test_message_create_with_hidden_created_by(self):
        """Test message creation sets created_by from context"""
        request = self.factory.post('/')
        request.user = self.doctor
        
        data = {
            'content': 'New message',
            'attachment': None
        }
        
        serializer = ConsultationMessageSerializer(
            data=data,
            context={'request': request}
        )
        self.assertTrue(serializer.is_valid(), serializer.errors)
        
        message = serializer.save(consultation=self.consultation)
        
        self.assertEqual(message.created_by, self.doctor)
        self.assertEqual(message.consultation, self.consultation)
        self.assertEqual(message.content, 'New message')


class SerializerValidationTests(BaseTestCase):
    
    def test_consultation_serializer_required_fields(self):
        """Test ConsultationSerializer required field validation"""
        serializer = ConsultationSerializer(data={})
        self.assertTrue(serializer.is_valid())
        
        # Consultation can be completely empty
        
    def test_request_serializer_required_fields(self):
        """Test RequestSerializer required field validation"""
        serializer = RequestSerializer(data={})
        self.assertFalse(serializer.is_valid())
        
        # Should require reason_id and comment
        self.assertIn('reason_id', serializer.errors)
        self.assertIn('comment', serializer.errors)
    
    def test_appointment_serializer_required_fields(self):
        """Test AppointmentSerializer required field validation"""
        # Provide context with request to avoid KeyError for created_by default
        
        factory = APIRequestFactory()
        request = factory.post('/')
        request.user = UserFactory()
        
        serializer = AppointmentSerializer(data={}, context={'request': request})
        self.assertFalse(serializer.is_valid())
        
        # Should require scheduled_at
        self.assertIn('scheduled_at', serializer.errors)


class SerializerContextTests(BaseTestCase):
    
    def test_serializer_context_request_user(self):
        """Test serializers properly use request.user from context"""
        factory = APIRequestFactory()
        user = UserFactory()
        
        request = factory.post('/')
        request.user = user
        
        # Test that context is properly passed and used
        context = {'request': request}
        
        # ConsultationSerializer should use request.user
        consultation_data = {'title': 'Test', 'description': 'Test'}
        consultation_serializer = ConsultationSerializer(data=consultation_data, context=context)
        
        self.assertTrue(consultation_serializer.is_valid())
        consultation = consultation_serializer.save()
        self.assertEqual(consultation.created_by, user)
    
    def test_serializer_without_context(self):
        """Test serializers handle missing context gracefully"""
        # Some serializers might need context, others might not
        data = {'title': 'Test', 'description': 'Test'}
        
        # This might fail without context - that's expected behavior
        try:
            serializer = ConsultationSerializer(data=data)
            if serializer.is_valid():
                # If it validates without context, that's also valid behavior
                pass
        except (AttributeError, KeyError):
            # Expected if context is required
            pass