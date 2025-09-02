import logging
from celery import shared_task
from django.contrib.auth import get_user_model
from .models import Request, RequestStatus, ReasonAssignmentMethod

User = get_user_model()
logger = logging.getLogger(__name__)


@shared_task
def handle_request(request_id):
    """
    Handle a consultation request by processing it based on the reason's assignment method.
    
    Args:
        request_id: The ID of the Request to process
        
    Returns:
        dict: Result of the processing with success status and details
    """
    try:
        # Get the request
        request = Request.objects.get(id=request_id)
        
        # Skip if already processed
        if request.status != RequestStatus.REQUESTED:
            logger.info(f"Request {request_id} already processed with status {request.status}")
            return {
                'success': True,
                'message': f'Request already processed with status {request.status}',
                'request_id': request_id
            }
        
        # Get assignment method
        assignment_method = request.reason.assignment_method
        logger.info(f"Processing request {request_id} with assignment method {assignment_method}")
        
        # Load and execute the appropriate assignment handler
        handler = _get_assignment_handler(assignment_method, request)
        if not handler:
            error_msg = f"No handler found for assignment method {assignment_method}"
            logger.error(error_msg)
            _mark_request_as_refused(request, error_msg)
            return {
                'success': False,
                'message': error_msg,
                'request_id': request_id
            }
        
        # Process the request
        result = handler.process()
        
        if result.success:
            # Mark request as accepted
            request.status = RequestStatus.ACCEPTED
            request.save()
            
            logger.info(f"Successfully processed request {request_id}")
            return {
                'success': True,
                'message': 'Request processed successfully',
                'request_id': request_id,
                'consultation_id': result.consultation.id if result.consultation else None,
                'appointment_id': result.appointment.id if result.appointment else None
            }
        else:
            # Mark request as refused with error message
            _mark_request_as_refused(request, result.error_message)
            logger.warning(f"Request {request_id} refused: {result.error_message}")
            return {
                'success': False,
                'message': result.error_message,
                'request_id': request_id
            }
            
    except Request.DoesNotExist:
        error_msg = f"Request {request_id} not found"
        logger.error(error_msg)
        return {
            'success': False,
            'message': error_msg,
            'request_id': request_id
        }
    except Exception as e:
        error_msg = f"Unexpected error processing request {request_id}: {str(e)}"
        logger.error(error_msg, exc_info=True)
        
        # Try to mark request as refused if it still exists
        try:
            request = Request.objects.get(id=request_id)
            _mark_request_as_refused(request, error_msg)
        except:
            pass
        
        return {
            'success': False,
            'message': error_msg,
            'request_id': request_id
        }


def _get_assignment_handler(assignment_method, request):
    """
    Get the appropriate assignment handler for the given method.
    
    Args:
        assignment_method: The assignment method from ReasonAssignmentMethod
        request: The Request instance
        
    Returns:
        BaseAssignmentHandler: The handler instance or None if not found
    """
    try:
        if assignment_method == ReasonAssignmentMethod.APPOINTMENT:
            from .assignments.appointment import AppointmentAssignmentHandler
            return AppointmentAssignmentHandler(request)
        elif assignment_method == ReasonAssignmentMethod.USER:
            # TODO: Implement UserAssignmentHandler
            logger.warning(f"USER assignment method not yet implemented")
            return None
        elif assignment_method == ReasonAssignmentMethod.QUEUE:
            # TODO: Implement QueueAssignmentHandler
            logger.warning(f"QUEUE assignment method not yet implemented")
            return None
        else:
            logger.error(f"Unknown assignment method: {assignment_method}")
            return None
    except ImportError as e:
        logger.error(f"Failed to import handler for {assignment_method}: {str(e)}")
        return None


def _mark_request_as_refused(request, error_message):
    """
    Mark a request as refused with the given error message.
    
    Args:
        request: The Request instance
        error_message: The error message to store
    """
    request.status = RequestStatus.REFUSED
    request.refused_reason = error_message
    request.save()
    logger.info(f"Marked request {request.id} as refused: {error_message}")
