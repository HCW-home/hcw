from . import BaseAssignmentHandler


class AssignmentHandler(BaseAssignmentHandler):
    """
    Handler for USER assignment method.
    Assigns consultation directly to a specific user (doctor) defined in reason.user_assignee.
    """

    display_name = "User"

    def process(self):
        """
        Process request with USER assignment method.
        Creates a consultation assigned directly to the user specified in reason.user_assignee.

        Returns:
            AssignmentResult: Result containing consultation or error
        """

        # Create consultation
        consultation = self._create_consultation()

        # Set specific user as owner
        consultation.owned_by = self.request.reason.user_assignee
        consultation.group = None  # No group assignment for direct user assignment
        consultation.save()

        self.request.consultation = consultation
        self.request.save()
