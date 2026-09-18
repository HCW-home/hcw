"""Which Nominatim is queried, and how fast, is configuration.

The public instance is capped at one request per second by its usage policy,
which makes large imports crawl and ties the geocoding to a third party. A
deployment therefore points NOMINATIM_URL at its own instance and lifts the pace
with NOMINATIM_RATE_LIMIT; a single tenant can point somewhere else again from
the admin, without touching the environment of the others.
"""

from unittest.mock import patch

from constance.test import override_config
from django.conf import settings
from django.db import connection
from django.test import override_settings
from django_tenants.test.cases import TenantTestCase

from users import tasks
from users.models import Organisation
from users.tests_geocode_backoff import SHARED_LOCMEM


class NominatimUrlTests(TenantTestCase):
    def test_admin_default_mirrors_the_environment(self):
        """An untouched admin field must not shadow NOMINATIM_URL."""
        self.assertEqual(
            settings.CONSTANCE_CONFIG["nominatim_url"][0], settings.NOMINATIM_URL
        )

    @override_config(nominatim_url="https://geo.example.org/search")
    def test_endpoint_is_used_as_given(self):
        self.assertEqual(tasks.nominatim_url(), "https://geo.example.org/search")

    @override_config(nominatim_url="https://geo.example.org/")
    def test_root_url_gets_the_search_endpoint(self):
        """A private instance is usually known by its root URL."""
        self.assertEqual(tasks.nominatim_url(), "https://geo.example.org/search")

    @override_config(nominatim_url="  https://geo.example.org/search  ")
    def test_pasted_url_is_trimmed(self):
        self.assertEqual(tasks.nominatim_url(), "https://geo.example.org/search")

    @override_config(nominatim_url="https://tenant.example.org")
    @override_settings(NOMINATIM_URL="https://env.example.org/search")
    def test_admin_setting_wins_over_the_environment(self):
        self.assertEqual(
            tasks.nominatim_url(), "https://tenant.example.org/search"
        )

    @override_config(nominatim_url="")
    @override_settings(NOMINATIM_URL="https://env.example.org")
    def test_cleared_admin_setting_falls_back_on_the_environment(self):
        self.assertEqual(tasks.nominatim_url(), "https://env.example.org/search")

    @override_settings(NOMINATIM_USER_AGENT="Clinic/2.0")
    def test_user_agent_is_configurable(self):
        self.assertEqual(tasks.nominatim_headers(), {"User-Agent": "Clinic/2.0"})


class NominatimRateLimitTests(TenantTestCase):
    def test_default_is_one_request_per_second(self):
        self.assertEqual(tasks.nominatim_min_interval(), 1)

    @override_settings(NOMINATIM_RATE_LIMIT="20/s")
    def test_faster_rates_shorten_the_interval(self):
        self.assertAlmostEqual(tasks.nominatim_min_interval(), 0.05)

    @override_settings(NOMINATIM_RATE_LIMIT="600/m")
    def test_other_periods_are_understood(self):
        self.assertAlmostEqual(tasks.nominatim_min_interval(), 0.1)

    @override_settings(NOMINATIM_RATE_LIMIT=None)
    def test_no_rate_limit_means_no_wait(self):
        self.assertEqual(tasks.nominatim_min_interval(), 0)

    @override_settings(NOMINATIM_RATE_LIMIT="whenever")
    def test_unusable_rate_falls_back_on_one_per_second(self):
        self.assertEqual(tasks.nominatim_min_interval(), 1)


@override_settings(CACHES=SHARED_LOCMEM)
class GeocodingRequestTests(TenantTestCase):
    def setUp(self):
        # Saving an address queues the very task under test; keep it off the
        # broker while setting the fixture up.
        queueing = patch.object(tasks.geocode_location, "delay")
        queueing.start()
        self.addCleanup(queueing.stop)
        self.organisation = Organisation.objects.create(
            name="Cabinet", street="7 Parvis Corentin Celton",
            postal_code="92130", city="Issy-Les-Moulineaux", country="France",
        )

    @override_config(nominatim_url="https://geo.example.org")
    @override_settings(NOMINATIM_USER_AGENT="Clinic/2.0")
    def test_task_queries_the_configured_instance(self):
        with patch.object(tasks.http_requests, "get") as get:
            get.return_value.status_code = 200
            get.return_value.json.return_value = [{"lat": "48.82", "lon": "2.28"}]
            tasks.geocode_location(
                "users", "organisation", self.organisation.pk,
                connection.schema_name,
            )

        self.assertEqual(get.call_args.args[0], "https://geo.example.org/search")
        self.assertEqual(
            get.call_args.kwargs["headers"], {"User-Agent": "Clinic/2.0"}
        )
        self.organisation.refresh_from_db()
        self.assertEqual(self.organisation.location, "48.82,2.28")
