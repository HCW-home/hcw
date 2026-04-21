from django.test import SimpleTestCase
from django.utils.datastructures import MultiValueDict
from django.db.models import Q

from fhir_server.search import (
    DateParam,
    RefParam,
    StringParam,
    TokenParam,
    apply_fhir_search,
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

    def filter(self, q):
        self.filters.append(q)
        return self

    def order_by(self, *args):
        self.ordering = args
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
