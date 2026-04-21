from django.test import RequestFactory, SimpleTestCase
from rest_framework.exceptions import NotFound, PermissionDenied, ValidationError

from fhir_server.exceptions import FhirOperationError, fhir_exception_handler


class _FakeRenderer:
    format = "fhir"


def _fhir_context():
    factory = RequestFactory()
    request = factory.get("/api/appointments/?format=fhir")
    request.accepted_renderer = _FakeRenderer()
    return {"request": request}


def _json_context():
    factory = RequestFactory()
    request = factory.get("/api/appointments/")
    return {"request": request}


class FhirExceptionHandlerTests(SimpleTestCase):

    def test_not_fhir_request_delegates_to_core_handler(self):
        response = fhir_exception_handler(NotFound(), _json_context())
        self.assertEqual(response.status_code, 404)
        self.assertNotIn("resourceType", response.data)

    def test_fhir_not_found_returns_operation_outcome(self):
        response = fhir_exception_handler(NotFound(), _fhir_context())
        self.assertEqual(response.status_code, 404)
        self.assertEqual(response.data["resourceType"], "OperationOutcome")
        self.assertEqual(response.data["issue"][0]["code"], "not-found")

    def test_fhir_validation_error(self):
        response = fhir_exception_handler(ValidationError({"name": ["required"]}), _fhir_context())
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.data["resourceType"], "OperationOutcome")
        self.assertEqual(response.data["issue"][0]["code"], "invalid")

    def test_fhir_permission_denied(self):
        response = fhir_exception_handler(PermissionDenied(), _fhir_context())
        self.assertEqual(response.status_code, 403)
        self.assertEqual(response.data["issue"][0]["code"], "forbidden")

    def test_custom_fhir_operation_error(self):
        exc = FhirOperationError("boom", code="processing", status_code=422)
        response = fhir_exception_handler(exc, _fhir_context())
        self.assertEqual(response.status_code, 422)
        self.assertEqual(response.data["issue"][0]["code"], "processing")
        self.assertIn("boom", response.data["issue"][0]["diagnostics"])
