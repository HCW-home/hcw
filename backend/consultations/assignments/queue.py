from . import BaseAssignmentHandler


class AssignmentHandler(BaseAssignmentHandler):
    """
    Handler for QUEUE assignment method.
    Assigns consultation to a queue for later assignment by queue managers.
    """

    display_name = "Queue"

    def process(self):
        """
        Process request with QUEUE assignment method.
        Creates a consultation assigned to the queue specified in reason.queue_assignee.

        Returns:
            AssignmentResult: Result containing consultation or error
        """

        # Create consultation
        consultation = self._create_consultation()

        # Set queue and remove specific owner
        consultation.group = self.request.reason.queue_assignee
        consultation.owned_by = None  # No specific owner, queue will handle assignment
        consultation.save()

        self.request.consultation = consultation
        self.request.save()
