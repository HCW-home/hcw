from django.test import SimpleTestCase, override_settings

from fhir_server.references import (
    build_absolute_url,
    build_identifier,
    build_reference,
    get_identifier_system,
    parse_reference,
)


@override_settings(FHIR_SYSTEM_BASE_URL="https://unit.test/fhir")
class ReferencesTests(SimpleTestCase):

    def test_build_reference_returns_relative(self):
        ref = build_reference("Patient", 42, display="John")
        self.assertEqual(ref, {"reference": "Patient/42", "display": "John"})

    def test_build_reference_none_for_missing_pk(self):
        self.assertIsNone(build_reference("Patient", None))

    def test_parse_reference_relative(self):
        self.assertEqual(parse_reference("Patient/5"), ("Patient", "5"))

    def test_parse_reference_absolute_url(self):
        rtype, ident = parse_reference("https://example/api/Patient/7")
        self.assertEqual(rtype, "Patient")
        self.assertEqual(ident, "7")

    def test_parse_reference_invalid(self):
        self.assertEqual(parse_reference(""), (None, None))
        self.assertEqual(parse_reference("garbage"), (None, None))

    def test_identifier_uses_custom_system_mapping(self):
        with override_settings(FHIR_IDENTIFIER_SYSTEMS={"Patient": "https://a/ns/p"}):
            self.assertEqual(get_identifier_system("Patient"), "https://a/ns/p")

    def test_identifier_fallback(self):
        with override_settings(FHIR_IDENTIFIER_SYSTEMS={}):
            self.assertEqual(
                get_identifier_system("Patient"),
                "https://unit.test/fhir/ns/patient-id",
            )

    def test_build_identifier_shape(self):
        ident = build_identifier("Patient", 9)
        self.assertEqual(ident["value"], "9")
        self.assertEqual(ident["use"], "official")
        self.assertTrue(ident["system"].endswith("/ns/patient-id"))

    def test_build_absolute_url_without_request(self):
        url = build_absolute_url(None, "Patient", 3)
        self.assertEqual(url, "https://unit.test/fhir/Patient/3")
