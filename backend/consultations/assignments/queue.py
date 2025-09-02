from . import BaseAssignmentHandler, AssignmentResult


class QueueAssignmentHandler(BaseAssignmentHandler):
    """
    Handler for QUEUE assignment method.
    Assigns consultation to a queue for later assignment by queue managers.
    """
    
    def process(self):
        """
        Process request with QUEUE assignment method.
        Creates a consultation assigned to the queue specified in reason.queue_assignee.
        
        Returns:
            AssignmentResult: Result containing consultation or error
        """
        try:
            # Validate that queue_assignee is set for QUEUE assignment method
            if not self.request.reason.queue_assignee:
                return AssignmentResult(
                    success=False,
                    error_message="QUEUE assignment method requires reason.queue_assignee to be set"
                )
            
            # Create consultation
            consultation = self._create_consultation()
            
            # Set queue and remove specific owner
            consultation.group = self.request.reason.queue_assignee
            consultation.owned_by = None  # No specific owner, queue will handle assignment
            consultation.save()
            
            return AssignmentResult(
                success=True,
                consultation=consultation
            )
            
        except Exception as e:
            return AssignmentResult(
                success=False,
                error_message=f"Failed to process QUEUE assignment: {str(e)}"
            )