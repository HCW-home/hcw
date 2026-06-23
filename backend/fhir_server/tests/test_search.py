from unittest.mock import patch

from django.test import SimpleTestCase, override_settings
from django.utils.datastructures import MultiValueDict
from django.db.models import Q

from fhir_server.exceptions import FhirOperationError
from fhir_server.search import (
    DateParam,
    IdentifierParam,
    RefParam,
    StringParam,
    TokenParam,
    _parse_param_key,
    apply_fhir_search,
    with_chained,
)


class _FakeMapper:
    search_params = {
        "status": TokenParam(field="status", mapping={"booked": "scheduled"}),
        "date": DateParam(field="scheduled_at"),
        "patient": RefParam(field="participant__user"),
        "name": StringParam(fields=["first_name", "last_name"]),
        "_lastUpdated": DateParam(field="updated_at"),
    }


class _QuerysetStub:
    def __init__(self):
        self.filters: list[Q] = []
        self.ordering: tuple | None = None
        self.distinct_called = False

    def filter(self, q):
        self.filters.append(q)
        return self

    def order_by(self, *args):
        self.ordering = args
        return self

    def distinct(self):
        self.distinct_called = True
        return self

    def count(self):
        return 0


def _qs_from(params: dict):
    mvd = MultiValueDict()
    for key, value in params.items():
        if isinstance(value, list):
            for v in value:
                mvd.appendlist(key, v)
        else:
            mvd.appendlist(key, value)
    return mvd


class SearchParamTranslationTests(SimpleTestCase):

    def test_token_with_fhir_mapping(self):
        qs = _QuerysetStub()
        result, control = apply_fhir_search(qs, _qs_from({"status": "booked"}), _FakeMapper())
        self.assertEqual(len(qs.filters), 1)
        self.assertIn("status__in", str(qs.filters[0]))
        self.assertIn("scheduled", str(qs.filters[0]))

    def test_token_modifier_not_negates(self):
        qs = _QuerysetStub()
        apply_fhir_search(qs, _qs_from({"status:not": "booked"}), _FakeMapper())
        self.assertTrue(qs.filters[0].negated)

    def test_date_prefix_ge(self):
        qs = _QuerysetStub()
        apply_fhir_search(qs, _qs_from({"date": "ge2026-04-01"}), _FakeMapper())
        self.assertIn("scheduled_at__gte", str(qs.filters[0]))

    def test_reference_strips_type(self):
        qs = _QuerysetStub()
        apply_fhir_search(qs, _qs_from({"patient": "Patient/7"}), _FakeMapper())
        self.assertIn("participant__user", str(qs.filters[0]))
        self.assertIn("7", str(qs.filters[0]))

    def test_string_modifier_exact(self):
        qs = _QuerysetStub()
        apply_fhir_search(qs, _qs_from({"name:exact": "Doe"}), _FakeMapper())
        self.assertIn("iexact", str(qs.filters[0]))

    def test_count_sort_controls(self):
        qs = _QuerysetStub()
        _, control = apply_fhir_search(
            qs, _qs_from({"_count": "5", "_sort": "-date"}), _FakeMapper(),
        )
        self.assertEqual(control["_count"], 5)
        self.assertEqual(qs.ordering, ("-scheduled_at",))

    def test_unknown_param_ignored_by_default(self):
        qs = _QuerysetStub()
        apply_fhir_search(qs, _qs_from({"made-up": "x"}), _FakeMapper())
        self.assertEqual(qs.filters, [])

    def test_last_updated(self):
        qs = _QuerysetStub()
        apply_fhir_search(qs, _qs_from({"_lastUpdated": "gt2026-01-01"}), _FakeMapper())
        self.assertIn("updated_at__gt", str(qs.filters[0]))


class _IdentifierMapper:
    """Mapper stub for IdentifierParam tests using the Appointment system URLs."""

    search_params = {
        "identifier": IdentifierParam(
            canonical_field="pk",
            external_field="external_id",
            resource_type="Appointment",
        ),
    }


class _IdentifierJoinedMapper:
    search_params = {
        "appointment": IdentifierParam(
            canonical_field="appointments__pk",
            external_field="appointments__external_id",
            resource_type="Appointment",
        ),
    }


_APPT_CANONICAL = "https://unit.test/fhir/ns/appointment-id"
_APPT_EXTERNAL = "https://ozonehis.example/ns/appointment-id"


@override_settings(FHIR_SYSTEM_BASE_URL="https://unit.test/fhir")
class IdentifierParamTests(SimpleTestCase):

    def setUp(self):
        # IdentifierParam reads the external system URL from Constance via
        # `get_external_identifier_system`. Patch it directly so the unit
        # test stays hermetic (no Constance, no DB).
        patcher = patch(
            "fhir_server.references.get_external_identifier_system",
            side_effect=lambda rt: _APPT_EXTERNAL if rt == "Appointment" else None,
        )
        patcher.start()
        self.addCleanup(patcher.stop)

    def test_canonical_system_pipe_value(self):
        qs = _QuerysetStub()
        apply_fhir_search(
            qs, _qs_from({"identifier": f"{_APPT_CANONICAL}|42"}), _IdentifierMapper(),
        )
        rendered = str(qs.filters[0])
        self.assertIn("'pk', '42'", rendered)
        self.assertNotIn("external_id", rendered)

    def test_external_system_pipe_value(self):
        qs = _QuerysetStub()
        apply_fhir_search(
            qs, _qs_from({"identifier": f"{_APPT_EXTERNAL}|OZ-7"}), _IdentifierMapper(),
        )
        rendered = str(qs.filters[0])
        self.assertIn("external_id__iexact", rendered)
        self.assertIn("OZ-7", rendered)

    def test_bare_numeric_matches_both_fields(self):
        qs = _QuerysetStub()
        apply_fhir_search(
            qs, _qs_from({"identifier": "42"}), _IdentifierMapper(),
        )
        rendered = str(qs.filters[0])
        self.assertIn("'pk', '42'", rendered)
        self.assertIn("external_id__iexact", rendered)

    def test_bare_string_matches_external_only(self):
        qs = _QuerysetStub()
        apply_fhir_search(
            qs, _qs_from({"identifier": "OZ-XYZ"}), _IdentifierMapper(),
        )
        rendered = str(qs.filters[0])
        self.assertIn("external_id__iexact", rendered)
        self.assertNotIn("'pk'", rendered)

    def test_empty_pipe_value_canonical_only(self):
        qs = _QuerysetStub()
        apply_fhir_search(
            qs, _qs_from({"identifier": "|42"}), _IdentifierMapper(),
        )
        rendered = str(qs.filters[0])
        self.assertIn("'pk', '42'", rendered)
        self.assertNotIn("external_id", rendered)

    def test_unknown_system_yields_no_match(self):
        qs = _QuerysetStub()
        apply_fhir_search(
            qs, _qs_from({"identifier": "https://nope.example|x"}), _IdentifierMapper(),
        )
        rendered = str(qs.filters[0])
        self.assertIn("pk__in", rendered)
        self.assertIn("[]", rendered)

    def test_modifier_not_negates(self):
        qs = _QuerysetStub()
        apply_fhir_search(
            qs,
            _qs_from({"identifier:not": f"{_APPT_EXTERNAL}|OZ-7"}),
            _IdentifierMapper(),
        )
        self.assertTrue(qs.filters[0].negated)

    def test_joined_field_triggers_distinct(self):
        qs = _QuerysetStub()
        apply_fhir_search(
            qs,
            _qs_from({"appointment": f"{_APPT_EXTERNAL}|OZ-7"}),
            _IdentifierJoinedMapper(),
        )
        self.assertTrue(qs.distinct_called)


class _ChainedMapper:
    """Stub mirroring AppointmentFhirMapper's chained references."""

    search_params = with_chained({
        "patient": RefParam(
            field="participant__user",
            extra=Q(participant__is_active=True, participant__user__is_practitioner=False),
            chainable=True,
            target_resource_type="Patient",
            name_fields=["first_name", "last_name"],
        ),
        "practitioner": RefParam(
            field="participant__user",
            extra=Q(participant__is_active=True, participant__user__is_practitioner=True),
            chainable=True,
            target_resource_type="Practitioner",
            name_fields=["first_name", "last_name"],
        ),
    })


@override_settings(FHIR_SYSTEM_BASE_URL="https://unit.test/fhir")
class ChainedSearchTests(SimpleTestCase):

    def setUp(self):
        patcher = patch(
            "fhir_server.references.get_external_identifier_system",
            side_effect=lambda rt: (
                "https://ozonehis.example/ns/patient-id" if rt == "Patient"
                else "https://ozonehis.example/ns/practitioner-id" if rt == "Practitioner"
                else None
            ),
        )
        patcher.start()
        self.addCleanup(patcher.stop)

    def _filter(self, params):
        qs = _QuerysetStub()
        apply_fhir_search(qs, _qs_from(params), _ChainedMapper())
        return qs

    def test_chained_identifier_canonical(self):
        qs = self._filter({"patient.identifier": "https://unit.test/fhir/ns/patient-id|42"})
        rendered = str(qs.filters[0])
        self.assertIn("participant__user__pk", rendered)
        self.assertIn("42", rendered)
        self.assertNotIn("external_id", rendered)

    def test_chained_identifier_external(self):
        qs = self._filter(
            {"patient.identifier": "https://ozonehis.example/ns/patient-id|PAT-1"}
        )
        rendered = str(qs.filters[0])
        self.assertIn("participant__user__external_id__iexact", rendered)
        self.assertIn("PAT-1", rendered)

    def test_chained_identifier_bare_numeric_both(self):
        qs = self._filter({"patient.identifier": "42"})
        rendered = str(qs.filters[0])
        self.assertIn("participant__user__pk", rendered)
        self.assertIn("participant__user__external_id__iexact", rendered)

    def test_chained_name_default_prefix(self):
        qs = self._filter({"patient.name": "Jo"})
        rendered = str(qs.filters[0])
        self.assertIn("participant__user__first_name__istartswith", rendered)
        self.assertIn("participant__user__last_name__istartswith", rendered)

    def test_chained_name_contains_modifier(self):
        qs = self._filter({"patient.name:contains": "ohn"})
        self.assertIn("__icontains", str(qs.filters[0]))

    def test_chained_extra_and_role_filter_propagated(self):
        qs = self._filter({"patient.identifier": "42"})
        rendered = str(qs.filters[0])
        self.assertIn("participant__is_active", rendered)
        self.assertIn("participant__user__is_practitioner", rendered)

    def test_practitioner_chain_filters_role_true(self):
        qs = self._filter({"practitioner.identifier": "42"})
        rendered = str(qs.filters[0])
        self.assertIn("participant__user__is_practitioner", rendered)
        self.assertIn("True", rendered)

    def test_chained_triggers_distinct(self):
        # .identifier (canonical_field has __) and .name (fields have __) both join.
        self.assertTrue(self._filter({"patient.identifier": "42"}).distinct_called)
        self.assertTrue(self._filter({"patient.name": "Jo"}).distinct_called)

    def test_unknown_chain_part_ignored_by_default(self):
        qs = self._filter({"patient.gender": "male"})
        self.assertEqual(qs.filters, [])

    def test_unknown_chain_part_strict_raises(self):
        with override_settings(FHIR_STRICT_SEARCH=True):
            with self.assertRaises(FhirOperationError):
                apply_fhir_search(
                    _QuerysetStub(), _qs_from({"patient.gender": "male"}), _ChainedMapper(),
                )

    def test_parse_key_splits_dot_before_modifier(self):
        self.assertEqual(_parse_param_key("patient.name:contains"), ("patient.name", "contains"))
        self.assertEqual(_parse_param_key("patient.identifier"), ("patient.identifier", None))
