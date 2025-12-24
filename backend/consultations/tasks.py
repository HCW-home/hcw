import logging

from celery import shared_task
from django.contrib.auth import get_user_model

from .assignments import AssignmentManager
from .models import Request

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
    request = Request.objects.get(id=request_id)

    with AssignmentManager(request) as assignment:
        assignment.handler.process()
