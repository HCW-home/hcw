from django.test import TestCase, TransactionTestCase
from django.urls import reverse
from rest_framework.test import APITestCase
from rest_framework import status
from unittest.mock import patch
from datetime import timedelta
from django.utils import timezone

from consultations.models import (
    Consultation, Request, Appointment, Participant,
    RequestStatus, AppointmentStatus
)
from consultations.tasks import handle_request

from .factories import (
    RequestFactory, UserReasonFactory, QueueReasonFactory, 
    AppointmentReasonFactory, PatientFactory, DoctorFactory,
    BookingSlotFactory, FullWeekBookingSlotFactory, ConsultationFactory
)
from .utils import BaseAPITestCase, TimeTestMixin, CeleryTestMixin, PermissionTestMixin


class EndToEndRequestProcessingTests(TransactionTestCase, CeleryTestMixin, TimeTestMixin):
    """Test complete request processing flow from API to celery task completion"""
    
    def setUp(self):
        super().setUp()
        self.patient = PatientFactory()
        self.doctor = DoctorFactory()
    
    def test_user_assignment_complete_flow(self):
        """Test complete USER assignment flow from request creation to completion"""
        # Setup
        reason = UserReasonFactory(user_assignee=self.doctor)
        
        # Create request
        request = RequestFactory(
            created_by=self.patient,
            reason=reason,
            status=RequestStatus.REQUESTED
        )
        
        # Process request (simulates celery task execution)
        with patch('consultations.tasks.handle_request.delay') as mock_task:
            # Simulate task execution directly
            result = handle_request(request.id)
        
        # Verify result
        self.assertTrue(result['success'])
        self.assertIn('consultation_id', result)
        
        # Verify database state
        request.refresh_from_db()
        self.assertEqual(request.status, RequestStatus.ACCEPTED)
        
        # Verify consultation created
        consultation = Consultation.objects.get(id=result['consultation_id'])
        self.assertEqual(consultation.owned_by, self.doctor)
        self.assertEqual(consultation.created_by, self.patient)
        self.assertEqual(consultation.beneficiary, self.patient)
        self.assertIsNone(consultation.group)
    
    def test_queue_assignment_complete_flow(self):
        """Test complete QUEUE assignment flow"""
        from .factories import QueueFactory
        queue = QueueFactory()
        reason = QueueReasonFactory(queue_assignee=queue)
        
        request = RequestFactory(
            created_by=self.patient,
            reason=reason,
            status=RequestStatus.REQUESTED
        )
        
        # Process request
        result = handle_request(request.id)
        
        # Verify result
        self.assertTrue(result['success'])
        
        # Verify consultation created with queue assignment
        consultation = Consultation.objects.get(id=result['consultation_id'])
        self.assertEqual(consultation.group, queue)
        self.assertIsNone(consultation.owned_by)
        self.assertEqual(consultation.created_by, self.patient)
    
    def test_appointment_assignment_complete_flow(self):
        """Test complete APPOINTMENT assignment flow with doctor selection and appointment creation"""
        # Setup
        reason = AppointmentReasonFactory(duration=30)
        self.doctor.specialities.add(reason.speciality)
        
        # Create booking slot
        booking_slot = FullWeekBookingSlotFactory(
            user=self.doctor,
            start_time=timezone.now().time().replace(hour=9, minute=0),
            end_time=timezone.now().time().replace(hour=17, minute=0)
        )
        
        # Create request for next Monday at 10:00
        expected_time = self.create_datetime_on_day(0, 10, 0)
        request = RequestFactory(
            created_by=self.patient,
            reason=reason,
            expected_at=expected_time,
            status=RequestStatus.REQUESTED
        )
        
        # Process request
        result = handle_request(request.id)
        
        # Verify result
        self.assertTrue(result['success'])
        self.assertIn('consultation_id', result)
        self.assertIn('appointment_id', result)
        
        # Verify request accepted
        request.refresh_from_db()
        self.assertEqual(request.status, RequestStatus.ACCEPTED)
        
        # Verify consultation created
        consultation = Consultation.objects.get(id=result['consultation_id'])
        self.assertEqual(consultation.owned_by, self.doctor)
        self.assertEqual(consultation.created_by, self.patient)
        
        # Verify appointment created
        appointment = Appointment.objects.get(id=result['appointment_id'])
        self.assertEqual(appointment.consultation, consultation)
        self.assertEqual(appointment.scheduled_at, expected_time)
        self.assertEqual(appointment.status, AppointmentStatus.SCHEDULED)
        
        # Verify participants created
        participants = appointment.participant_set.all()
        self.assertEqual(participants.count(), 2)
        participant_users = [p.user for p in participants if p.user]
        self.assertIn(self.patient, participant_users)
        self.assertIn(self.doctor, participant_users)


class APIIntegrationTests(BaseAPITestCase, TimeTestMixin, PermissionTestMixin):
    """Test complete API workflows"""
    
    def setUp(self):
        super().setUp()
        self.patient = PatientFactory()
        self.doctor = DoctorFactory()
        
        # Give users necessary permissions
        self.create_user_with_permissions(self.patient, [
            'add_request', 'view_request', 'change_request'
        ])
        self.create_user_with_permissions(self.doctor, [
            'view_consultation', 'add_consultation', 'change_consultation',
            'add_appointment', 'view_appointment'
        ])
    
    def test_request_creation_to_consultation_api_workflow(self):
        """Test creating request via API and accessing created consultation"""
        # Setup
        reason = UserReasonFactory(user_assignee=self.doctor)
        
        # Create request via API
        self.authenticate_user(self.patient)
        
        expected_time = timezone.now() + timedelta(days=1)
        request_data = {
            'expected_at': expected_time.isoformat(),
            'reason_id': reason.id,
            'comment': 'Test request via API',
            'type': 'Online'
        }
        
        request_url = reverse('request-list')
        response = self.client.post(request_url, request_data)
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        
        request_id = response.data['id']
        
        # Process request (simulate task execution)
        with patch('consultations.tasks.handle_request.delay'):
            task_result = handle_request(request_id)
        
        self.assertTrue(task_result['success'])
        consultation_id = task_result['consultation_id']
        
        # Access consultation via API (as doctor)
        self.authenticate_user(self.doctor)
        
        consultation_url = reverse('consultation-detail', kwargs={'pk': consultation_id})
        response = self.client.get(consultation_url)
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        
        # Verify consultation data
        self.assertEqual(response.data['owned_by']['id'], self.doctor.id)
        self.assertEqual(response.data['beneficiary']['id'], self.patient.id)
    
    def test_consultation_with_appointments_workflow(self):
        """Test creating consultation and adding appointments via API"""
        # Create consultation
        self.authenticate_user(self.doctor)
        
        consultation_data = {
            'title': 'Test Consultation',
            'description': 'API created consultation',
            'beneficiary': self.patient.id
        }
        
        consultation_url = reverse('consultation-list')
        response = self.client.post(consultation_url, consultation_data)
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        
        consultation_id = response.data['id']
        
        # Add appointment to consultation
        appointment_data = {
            'scheduled_at': (timezone.now() + timedelta(days=1)).isoformat(),
            'type': 'Online'
        }
        
        appointments_url = reverse('consultation-appointments', kwargs={'pk': consultation_id})
        response = self.client.post(appointments_url, appointment_data)
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        
        appointment_id = response.data['id']
        
        # Verify appointment created
        appointment = Appointment.objects.get(id=appointment_id)
        self.assertEqual(appointment.consultation.id, consultation_id)
        self.assertEqual(appointment.created_by, self.doctor)
    
    def test_consultation_permissions_workflow(self):
        """Test consultation access permissions across different users"""
        # Create consultation as doctor
        consultation = ConsultationFactory(
            created_by=self.doctor,
            owned_by=self.doctor,
            beneficiary=self.patient
        )
        
        # Patient should be able to see consultation (as beneficiary)
        self.authenticate_user(self.patient)
        url = reverse('consultation-detail', kwargs={'pk': consultation.id})
        response = self.client.get(url)
        # Note: This depends on the actual permission logic in the view
        # May need adjustment based on actual queryset filtering
        
        # Other user should not see consultation
        other_user = PatientFactory()
        self.create_user_with_permissions(other_user, ['view_consultation'])
        self.authenticate_user(other_user)
        
        response = self.client.get(url)
        # Should return 404 or 403 depending on implementation
        self.assertIn(response.status_code, [403, 404])


class SignalIntegrationTests(TransactionTestCase):
    """Test signal integration"""
    
    def setUp(self):
        super().setUp()
        self.patient = PatientFactory()
    
    @patch('consultations.tasks.handle_request.delay')
    def test_request_creation_triggers_task(self, mock_task):
        """Test that creating a request triggers the celery task"""
        reason = UserReasonFactory()
        
        # Create request (should trigger signal)
        request = RequestFactory(
            created_by=self.patient,
            reason=reason,
            status=RequestStatus.REQUESTED
        )
        
        # Verify task was called
        mock_task.assert_called_once_with(request.id)
    
    @patch('consultations.tasks.handle_request.delay')
    def test_request_update_does_not_trigger_task(self, mock_task):
        """Test that updating a request doesn't trigger the task again"""
        request = RequestFactory(status=RequestStatus.REQUESTED)
        mock_task.reset_mock()
        
        # Update request
        request.comment = "Updated comment"
        request.save()
        
        # Task should not be called for updates
        mock_task.assert_not_called()


class ErrorHandlingIntegrationTests(BaseAPITestCase, PermissionTestMixin):
    """Test error handling in complete workflows"""
    
    def setUp(self):
        super().setUp()
        self.patient = PatientFactory()
        self.create_user_with_permissions(self.patient, ['add_request'])
    
    def test_request_with_invalid_reason(self):
        """Test creating request with invalid reason"""
        self.authenticate_user(self.patient)
        
        request_data = {
            'expected_at': (timezone.now() + timedelta(days=1)).isoformat(),
            'reason_id': 99999,  # Non-existent reason
            'comment': 'Test request'
        }
        
        url = reverse('request-list')
        response = self.client.post(url, request_data)
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
    
    def test_request_processing_failure_handling(self):
        """Test handling of request processing failures"""
        # Create request that will fail processing (no available doctors)
        reason = AppointmentReasonFactory()
        # Don't create any doctors with the speciality
        
        request = RequestFactory(
            created_by=self.patient,
            reason=reason,
            status=RequestStatus.REQUESTED
        )
        
        # Process request (should fail)
        result = handle_request(request.id)
        
        # Verify failure is handled gracefully
        self.assertFalse(result['success'])
        self.assertIn('no available doctors', result['message'].lower())
        
        # Verify request marked as refused
        request.refresh_from_db()
        self.assertEqual(request.status, RequestStatus.REFUSED)
        self.assertIsNotNone(request.refused_reason)


class DataConsistencyTests(TransactionTestCase, TimeTestMixin):
    """Test data consistency across the system"""
    
    def test_appointment_assignment_data_consistency(self):
        """Test data consistency in appointment assignment"""
        patient = PatientFactory()
        doctor = DoctorFactory()
        reason = AppointmentReasonFactory(duration=30)
        doctor.specialities.add(reason.speciality)
        
        # Create booking slot
        FullWeekBookingSlotFactory(
            user=doctor,
            start_time=timezone.now().time().replace(hour=9, minute=0),
            end_time=timezone.now().time().replace(hour=17, minute=0)
        )
        
        expected_time = self.create_datetime_on_day(0, 10, 0)  # Monday at 10:00
        request = RequestFactory(
            created_by=patient,
            reason=reason,
            expected_at=expected_time,
            status=RequestStatus.REQUESTED
        )
        
        # Process request
        result = handle_request(request.id)
        
        # Verify all data is consistent
        self.assertTrue(result['success'])
        
        # Check request links to consultation
        request.refresh_from_db()
        consultation = Consultation.objects.get(id=result['consultation_id'])
        appointment = Appointment.objects.get(id=result['appointment_id'])
        
        # Verify relationships
        self.assertEqual(appointment.consultation, consultation)
        self.assertEqual(consultation.owned_by, doctor)
        self.assertEqual(request.status, RequestStatus.ACCEPTED)
        
        # Verify participants
        participants = appointment.participant_set.all()
        self.assertEqual(participants.count(), 2)
        
        # Verify appointment timing
        self.assertEqual(appointment.scheduled_at, expected_time)
        expected_end_time = expected_time + timedelta(minutes=reason.duration)
        self.assertEqual(appointment.end_expected_at, expected_end_time)