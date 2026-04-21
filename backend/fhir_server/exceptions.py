"""FHIR OperationOutcome exception handler and helpers."""
import logging
import traceback

from django.conf import settings
from pydantic import ValidationError as PydanticValidationError
from rest_framework import status
from rest_framework.exceptions import (
    APIException,
    AuthenticationFailed,
    MethodNotAllowed,
    NotAuthenticated,
    NotFound,
    ParseError,
    PermissionDenied,
    UnsupportedMediaType,
    ValidationError,
)
from rest_framework.response import Response

from core.exceptions import custom_exception_handler

logger = logging.getLogger(__name__)


FHIR_MEDIA_TYPE = "application/fhir+json"


def is_fhir_request(request) -> bool:
    """Return True if the request expects a FHIR-formatted response."""
    if request is None:
        return False
    renderer = getattr(request, "accepted_renderer", None)
    if renderer is not None and getattr(renderer, "format", None) == "fhir":
        return True
    accepted = getattr(request, "accepted_media_type", "") or ""
    if FHIR_MEDIA_TYPE in accepted:
        return True
    if request.query_params.get("format") == "fhir" or request.query_params.get("_format") == "fhir":
        return True
    return False


class FhirOperationError(APIException):
    """Raise to emit a specific FHIR OperationOutcome."""

    status_code = status.HTTP_400_BAD_REQUEST

    def __init__(self, detail, *, code: str = "invalid", severity: str = "error",
                 status_code: int | None = None, location: list[str] | None = None):
        super().__init__(detail)
        self.fhir_code = code
        self.fhir_severity = severity
        self.fhir_location = location or []
        if status_code is not None:
            self.status_code = status_code


def _issue(severity: str, code: str, diagnostics: str | None = None,
           location: list[str] | None = None) -> dict:
    issue = {"severity": severity, "code": code}
    if diagnostics:
        issue["diagnostics"] = diagnostics
    if location:
        issue["expression"] = location
    return issue


def _build_operation_outcome(issues: list[dict]) -> dict:
    return {"resourceType": "OperationOutcome", "issue": issues or [
        {"severity": "error", "code": "processing"}
    ]}


def _issues_from_drf_validation(detail, prefix: str = "") -> list[dict]:
    issues: list[dict] = []
    if isinstance(detail, dict):
        for key, value in detail.items():
            loc = f"{prefix}.{key}" if prefix else str(key)
            issues.extend(_issues_from_drf_validation(value, loc))
    elif isinstance(detail, list):
        for i, value in enumerate(detail):
            loc = f"{prefix}[{i}]" if prefix else f"[{i}]"
            if isinstance(value, (dict, list)):
                issues.extend(_issues_from_drf_validation(value, loc))
            else:
                issues.append(_issue("error", "invalid", str(value), [prefix] if prefix else None))
    else:
        issues.append(_issue("error", "invalid", str(detail), [prefix] if prefix else None))
    return issues


def _issues_from_pydantic(exc: PydanticValidationError) -> list[dict]:
    issues = []
    for err in exc.errors():
        loc = ".".join(str(part) for part in err.get("loc", []))
        issues.append(_issue("error", "invalid", err.get("msg", ""), [loc] if loc else None))
    return issues or [_issue("error", "invalid", "Invalid FHIR payload")]


def fhir_exception_handler(exc, context):
    """DRF exception handler that emits OperationOutcome for FHIR requests.

    Delegates to the existing `custom_exception_handler` when the request is
    not FHIR.
    """
    request = context.get("request") if context else None

    # Non-FHIR requests keep the legacy handler.
    if not is_fhir_request(request):
        return custom_exception_handler(exc, context)

    if isinstance(exc, FhirOperationError):
        outcome = _build_operation_outcome([_issue(
            exc.fhir_severity, exc.fhir_code, str(exc.detail), exc.fhir_location
        )])
        return Response(outcome, status=exc.status_code, content_type=FHIR_MEDIA_TYPE)

    if isinstance(exc, PydanticValidationError):
        outcome = _build_operation_outcome(_issues_from_pydantic(exc))
        return Response(outcome, status=status.HTTP_400_BAD_REQUEST, content_type=FHIR_MEDIA_TYPE)

    if isinstance(exc, ValidationError):
        outcome = _build_operation_outcome(_issues_from_drf_validation(exc.detail))
        return Response(outcome, status=exc.status_code, content_type=FHIR_MEDIA_TYPE)

    if isinstance(exc, ParseError):
        outcome = _build_operation_outcome([_issue("error", "structure", str(exc.detail))])
        return Response(outcome, status=exc.status_code, content_type=FHIR_MEDIA_TYPE)

    if isinstance(exc, (NotAuthenticated, AuthenticationFailed)):
        outcome = _build_operation_outcome([_issue("error", "login", str(exc.detail))])
        return Response(outcome, status=exc.status_code, content_type=FHIR_MEDIA_TYPE)

    if isinstance(exc, PermissionDenied):
        outcome = _build_operation_outcome([_issue("error", "forbidden", str(exc.detail))])
        return Response(outcome, status=exc.status_code, content_type=FHIR_MEDIA_TYPE)

    if isinstance(exc, NotFound):
        outcome = _build_operation_outcome([_issue("error", "not-found", str(exc.detail))])
        return Response(outcome, status=exc.status_code, content_type=FHIR_MEDIA_TYPE)

    if isinstance(exc, MethodNotAllowed):
        outcome = _build_operation_outcome([_issue("error", "not-supported", str(exc.detail))])
        return Response(outcome, status=exc.status_code, content_type=FHIR_MEDIA_TYPE)

    if isinstance(exc, UnsupportedMediaType):
        outcome = _build_operation_outcome([_issue("error", "not-supported", str(exc.detail))])
        return Response(outcome, status=exc.status_code, content_type=FHIR_MEDIA_TYPE)

    if isinstance(exc, APIException):
        outcome = _build_operation_outcome([_issue("error", "processing", str(exc.detail))])
        return Response(outcome, status=exc.status_code, content_type=FHIR_MEDIA_TYPE)

    logger.exception("Unhandled exception in FHIR view", exc_info=exc)
    diagnostics = "".join(traceback.format_exception(exc)) if settings.DEBUG else None
    outcome = _build_operation_outcome([_issue(
        "fatal", "exception", diagnostics or "Unhandled server error"
    )])
    return Response(outcome, status=status.HTTP_500_INTERNAL_SERVER_ERROR, content_type=FHIR_MEDIA_TYPE)
