from django.test import RequestFactory, SimpleTestCase, override_settings

from fhir_server.bundle import build_searchset_bundle
from fhir_server.mappers import FhirResourceMapper


class _FakeInstance:
    def __init__(self, pk):
        self.pk = pk


class _FakeMapper(FhirResourceMapper):
    resource_type = "Fake"

    def to_fhir(self, instance, *, context=None):
        return {"resourceType": "Fake", "id": str(instance.pk)}


class _FakePaginator:
    def __init__(self, total, next_url=None, prev_url=None):
        class _Page:
            class paginator:
                count = total
        self.page = _Page()
        self._next = next_url
        self._prev = prev_url

    def get_next_link(self):
        return self._next

    def get_previous_link(self):
        return self._prev


@override_settings(FHIR_SYSTEM_BASE_URL="https://unit.test/fhir")
class BundleTests(SimpleTestCase):

    def test_searchset_shape(self):
        factory = RequestFactory()
        request = factory.get("/api/fakes/?foo=1")
        instances = [_FakeInstance(1), _FakeInstance(2)]
        paginator = _FakePaginator(total=10, next_url="https://unit.test/page2")

        bundle = build_searchset_bundle(
            request=request,
            mapper=_FakeMapper(),
            instances=instances,
            paginator=paginator,
        )

        self.assertEqual(bundle["resourceType"], "Bundle")
        self.assertEqual(bundle["type"], "searchset")
        self.assertEqual(bundle["total"], 10)
        self.assertEqual(len(bundle["entry"]), 2)
        self.assertEqual(bundle["entry"][0]["search"]["mode"], "match")
        self.assertTrue(bundle["entry"][0]["fullUrl"].endswith("/api/Fake/1"))
        relations = {lnk["relation"] for lnk in bundle["link"]}
        self.assertIn("self", relations)
        self.assertIn("next", relations)

    def test_include_entries_marked(self):
        factory = RequestFactory()
        request = factory.get("/api/fakes/")
        bundle = build_searchset_bundle(
            request=request,
            mapper=_FakeMapper(),
            instances=[_FakeInstance(1)],
            include_entries=[(_FakeMapper(), _FakeInstance(99))],
        )
        modes = [e["search"]["mode"] for e in bundle["entry"]]
        self.assertEqual(modes, ["match", "include"])
