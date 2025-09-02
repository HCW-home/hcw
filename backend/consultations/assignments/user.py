from . import BaseAssignmentHandler, AssignmentResult


class UserAssignmentHandler(BaseAssignmentHandler):
    """
    Handler for USER assignment method.
    Assigns consultation directly to a specific user (doctor) defined in reason.user_assignee.
    """
    
    def process(self):
        """
        Process request with USER assignment method.
        Creates a consultation assigned directly to the user specified in reason.user_assignee.
        
        Returns:
            AssignmentResult: Result containing consultation or error
        """
        try:
            # Validate that user_assignee is set for USER assignment method
            if not self.request.reason.user_assignee:
                return AssignmentResult(
                    success=False,
                    error_message="USER assignment method requires reason.user_assignee to be set"
                )
            
            # Create consultation
            consultation = self._create_consultation()
            
            # Set specific user as owner
            consultation.owned_by = self.request.reason.user_assignee
            consultation.group = None  # No group assignment for direct user assignment
            consultation.save()
            
            return AssignmentResult(
                success=True,
                consultation=consultation
            )
            
        except Exception as e:
            return AssignmentResult(
                success=False,
                error_message=f"Failed to process USER assignment: {str(e)}"
            )