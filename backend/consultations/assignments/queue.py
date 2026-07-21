from asgiref.sync import async_to_sync
from channels.layers import get_channel_layer
from core.channel_groups import user_group

from . import BaseAssignmentHandler


class AssignmentHandler(BaseAssignmentHandler):
    """
    Handler for QUEUE assignment method.
    Assigns consultation to a queue for later assignment by queue managers.
    """

    display_name = "Create followup and assign to queue / group"
    required_fields = ["queue_assignee", "speciality"]

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

        self._notify_queue_members(consultation)

    def _notify_queue_members(self, consultation):
        """Push an `incoming request` WebSocket event to every member of the
        queue so practitioners get a ringtone + toast and can pick it up.
        """
        if not consultation.group:
            return

        channel_layer = get_channel_layer()
        if not channel_layer:
            return

        requester = self.request.created_by
        requester_name = ""
        if requester:
            requester_name = requester.name or requester.email or ""

        payload = {
            "type": "consultation",
            "consultation_id": consultation.pk,
            "state": "request_assigned",
            "data": {
                "user_id": requester.pk if requester else None,
                "user_name": requester_name,
                "queue_name": consultation.group.name,
                "reason_name": self.request.reason.name if self.request.reason else "",
            },
        }

        for user in consultation.group.users.all():
            async_to_sync(channel_layer.group_send)(user_group(user.pk), payload)
