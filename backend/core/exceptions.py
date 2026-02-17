from django.db.models.deletion import ProtectedError
from rest_framework.response import Response
from rest_framework import status
from rest_framework.views import exception_handler
from django.utils.translation import gettext_lazy as _
import traceback

def custom_exception_handler(exc, context):
    import logging
    logger = logging.getLogger(__name__)

    response = exception_handler(exc, context)

    if response is not None:
        return response

    logger.exception("Unhandled exception in API view", exc_info=exc)

    return Response(
        {
            "detail": _("An unhandled error has occured"),
            "traceback": "".join(traceback.format_exception(exc)),
        },
        status=status.HTTP_500_INTERNAL_SERVER_ERROR,
    )
