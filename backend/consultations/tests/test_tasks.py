from django.test import TestCase
from unittest.mock import patch, MagicMock
from celery.exceptions import Retry

from consultations.models import Request, RequestStatus
from consultations.tasks import handle_request
from consultations.assignments import AssignmentResult

from .factories import (
    RequestFactory, ConsultationFactory, AppointmentFactory,
    UserReasonFactory, QueueReasonFactory, AppointmentReasonFactory,
    PatientFactory
)
from .utils import BaseTestCase, CeleryTestMixin


class HandleRequestTaskTests(BaseTestCase, CeleryTestMixin):
    
    def setUp(self):
        super().setUp()
        self.patient = PatientFactory()
        self.reason = UserReasonFactory()
        self.request = RequestFactory(
            created_by=self.patient,
            reason=self.reason,
            status=RequestStatus.REQUESTED
        )
    
    def test_handle_request_success(self):
        """Test successful request handling"""
        consultation = ConsultationFactory()
        success_result = AssignmentResult(
            success=True,
            consultation=consultation
        )
        
        with patch('consultations.tasks._get_assignment_handler') as mock_get_handler:
            mock_handler = MagicMock()
            mock_handler.process.return_value = success_result
            mock_get_handler.return_value = mock_handler
            
            result = handle_request(self.request.id)
        
        # Check result
        self.assertTrue(result['success'])
        self.assertEqual(result['request_id'], self.request.id)
        self.assertEqual(result['consultation_id'], consultation.id)
        self.assertIsNone(result['appointment_id'])
        
        # Check request status updated
        self.request.refresh_from_db()
        self.assertEqual(self.request.status, RequestStatus.ACCEPTED)
    
    def test_handle_request_success_with_appointment(self):
        """Test successful request handling with appointment"""
        consultation = ConsultationFactory()
        appointment = AppointmentFactory(consultation=consultation)
        success_result = AssignmentResult(
            success=True,
            consultation=consultation,
            appointment=appointment
        )
        
        with patch('consultations.tasks._get_assignment_handler') as mock_get_handler:
            mock_handler = MagicMock()
            mock_handler.process.return_value = success_result
            mock_get_handler.return_value = mock_handler
            
            result = handle_request(self.request.id)
        
        # Check result includes appointment
        self.assertTrue(result['success'])
        self.assertEqual(result['consultation_id'], consultation.id)
        self.assertEqual(result['appointment_id'], appointment.id)
    
    def test_handle_request_assignment_failure(self):
        """Test request handling when assignment fails"""
        error_message = "No available doctors"
        failure_result = AssignmentResult(
            success=False,
            error_message=error_message
        )
        
        with patch('consultations.tasks._get_assignment_handler') as mock_get_handler:
            mock_handler = MagicMock()
            mock_handler.process.return_value = failure_result
            mock_get_handler.return_value = mock_handler
            
            result = handle_request(self.request.id)
        
        # Check result
        self.assertFalse(result['success'])
        self.assertEqual(result['message'], error_message)
        self.assertEqual(result['request_id'], self.request.id)
        
        # Check request marked as refused
        self.request.refresh_from_db()
        self.assertEqual(self.request.status, RequestStatus.REFUSED)
        self.assertEqual(self.request.refused_reason, error_message)
    
    def test_handle_request_no_handler_found(self):
        """Test request handling when no handler found"""
        with patch('consultations.tasks._get_assignment_handler') as mock_get_handler:
            mock_get_handler.return_value = None
            
            result = handle_request(self.request.id)
        
        # Check result
        self.assertFalse(result['success'])
        self.assertIn("No handler found", result['message'])
        
        # Check request marked as refused
        self.request.refresh_from_db()
        self.assertEqual(self.request.status, RequestStatus.REFUSED)
    
    def test_handle_request_already_processed(self):
        """Test handling already processed request"""
        # Mark request as already accepted
        self.request.status = RequestStatus.ACCEPTED
        self.request.save()
        
        result = handle_request(self.request.id)
        
        # Should return success without processing
        self.assertTrue(result['success'])
        self.assertIn("already processed", result['message'])
        self.assertEqual(result['request_id'], self.request.id)
    
    def test_handle_request_not_found(self):
        """Test handling non-existent request"""
        non_existent_id = 99999
        
        result = handle_request(non_existent_id)
        
        # Check error result
        self.assertFalse(result['success'])
        self.assertIn("not found", result['message'])
        self.assertEqual(result['request_id'], non_existent_id)
    
    def test_handle_request_unexpected_exception(self):
        """Test handling unexpected exceptions"""
        with patch('consultations.tasks._get_assignment_handler') as mock_get_handler:
            mock_get_handler.side_effect = Exception("Unexpected error")
            
            result = handle_request(self.request.id)
        
        # Check error result
        self.assertFalse(result['success'])
        self.assertIn("Unexpected error", result['message'])
        
        # Check request marked as refused
        self.request.refresh_from_db()
        self.assertEqual(self.request.status, RequestStatus.REFUSED)
    
    def test_handle_request_logs_processing_steps(self):
        """Test that request processing is properly logged"""
        consultation = ConsultationFactory()
        success_result = AssignmentResult(success=True, consultation=consultation)
        
        with patch('consultations.tasks._get_assignment_handler') as mock_get_handler:
            mock_handler = MagicMock()
            mock_handler.process.return_value = success_result
            mock_get_handler.return_value = mock_handler
            
            with patch('consultations.tasks.logger') as mock_logger:
                handle_request(self.request.id)
        
        # Check logging calls
        mock_logger.info.assert_called()
        info_calls = [call.args[0] for call in mock_logger.info.call_args_list]
        
        # Should log processing start and success
        self.assertTrue(any("Processing request" in call for call in info_calls))
        self.assertTrue(any("Successfully processed" in call for call in info_calls))


class GetAssignmentHandlerTests(BaseTestCase):
    
    def test_get_assignment_handler_user_method(self):
        """Test _get_assignment_handler for USER method"""
        from consultations.tasks import _get_assignment_handler
        from consultations.assignments.user import UserAssignmentHandler
        
        reason = UserReasonFactory()
        request = RequestFactory(reason=reason)
        
        handler = _get_assignment_handler(request)
        
        self.assertIsInstance(handler, UserAssignmentHandler)
        self.assertEqual(handler.request, request)
    
    def test_get_assignment_handler_queue_method(self):
        """Test _get_assignment_handler for QUEUE method"""
        from consultations.tasks import _get_assignment_handler
        from consultations.assignments.queue import QueueAssignmentHandler
        
        reason = QueueReasonFactory()
        request = RequestFactory(reason=reason)
        
        handler = _get_assignment_handler(request)
        
        self.assertIsInstance(handler, QueueAssignmentHandler)
    
    def test_get_assignment_handler_appointment_method(self):
        """Test _get_assignment_handler for APPOINTMENT method"""
        from consultations.tasks import _get_assignment_handler
        from consultations.assignments.appointment import AppointmentAssignmentHandler
        
        reason = AppointmentReasonFactory()
        request = RequestFactory(reason=reason)
        
        handler = _get_assignment_handler(request)
        
        self.assertIsInstance(handler, AppointmentAssignmentHandler)
    
    def test_get_assignment_handler_import_error(self):
        """Test _get_assignment_handler handles import errors"""
        from consultations.tasks import _get_assignment_handler
        
        reason = UserReasonFactory()
        request = RequestFactory(reason=reason)
        
        with patch('consultations.assignments.get_assignment_handler') as mock_get_handler:
            mock_get_handler.side_effect = ImportError("Module not found")
            
            handler = _get_assignment_handler(request)
        
        self.assertIsNone(handler)
    
    def test_get_assignment_handler_value_error(self):
        """Test _get_assignment_handler handles unknown assignment methods"""
        from consultations.tasks import _get_assignment_handler
        
        reason = UserReasonFactory()
        reason.assignment_method = "UNKNOWN"
        request = RequestFactory(reason=reason)
        
        with patch('consultations.assignments.get_assignment_handler') as mock_get_handler:
            mock_get_handler.side_effect = ValueError("Unknown method")
            
            handler = _get_assignment_handler(request)
        
        self.assertIsNone(handler)


class MarkRequestAsRefusedTests(BaseTestCase):
    
    def test_mark_request_as_refused(self):
        """Test _mark_request_as_refused function"""
        from consultations.tasks import _mark_request_as_refused
        
        request = RequestFactory(status=RequestStatus.REQUESTED)
        error_message = "Test error message"
        
        _mark_request_as_refused(request, error_message)
        
        request.refresh_from_db()
        self.assertEqual(request.status, RequestStatus.REFUSED)
        self.assertEqual(request.refused_reason, error_message)
    
    def test_mark_request_as_refused_logging(self):
        """Test _mark_request_as_refused logs the action"""
        from consultations.tasks import _mark_request_as_refused
        
        request = RequestFactory()
        error_message = "Test error"
        
        with patch('consultations.tasks.logger') as mock_logger:
            _mark_request_as_refused(request, error_message)
        
        mock_logger.info.assert_called_once()
        log_message = mock_logger.info.call_args[0][0]
        self.assertIn(f"request {request.id}", log_message)
        self.assertIn("refused", log_message)


class TaskIntegrationTests(BaseTestCase):
    """Integration tests for the complete task flow"""
    
    def test_user_assignment_end_to_end(self):
        """Test complete USER assignment flow"""
        from consultations.tasks import handle_request
        
        reason = UserReasonFactory()
        request = RequestFactory(
            reason=reason,
            status=RequestStatus.REQUESTED
        )
        
        result = handle_request(request.id)
        
        # Check successful result
        self.assertTrue(result['success'])
        self.assertIn('consultation_id', result)
        self.assertIsNone(result['appointment_id'])  # No appointment for USER method
        
        # Check request accepted
        request.refresh_from_db()
        self.assertEqual(request.status, RequestStatus.ACCEPTED)
        
        # Check consultation created
        consultation_id = result['consultation_id']
        from consultations.models import Consultation
        consultation = Consultation.objects.get(id=consultation_id)
        self.assertEqual(consultation.owned_by, reason.user_assignee)
        self.assertEqual(consultation.created_by, request.created_by)
    
    def test_queue_assignment_end_to_end(self):
        """Test complete QUEUE assignment flow"""
        from consultations.tasks import handle_request
        
        reason = QueueReasonFactory()
        request = RequestFactory(
            reason=reason,
            status=RequestStatus.REQUESTED
        )
        
        result = handle_request(request.id)
        
        # Check successful result
        self.assertTrue(result['success'])
        self.assertIn('consultation_id', result)
        self.assertIsNone(result['appointment_id'])  # No appointment for QUEUE method
        
        # Check consultation properties
        consultation_id = result['consultation_id']
        from consultations.models import Consultation
        consultation = Consultation.objects.get(id=consultation_id)
        self.assertEqual(consultation.group, reason.queue_assignee)
        self.assertIsNone(consultation.owned_by)  # No specific owner for queue assignment