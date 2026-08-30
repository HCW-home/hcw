"""Regression tests: a Nominatim 429 must pause every geocoding task at once.

Bulk imports save hundreds of thousands of records, and each save queues a
geocoding task. Nominatim allows one request per second and answers 429 past
that, so a single task backing off on its own is not enough: the queue behind it
would keep the rate limit pinned. The pause is therefore shared, and it lives in
the schema-agnostic cache because the quota belongs to our IP, not to a tenant.
"""

import time
from unittest.mock import patch

from django.core.cache import caches
from django.db import connection
from django.test import override_settings
from django_tenants.test.cases import TenantTestCase

from users import tasks
from users.models import Organisation

SHARED_LOCMEM = {
    "default": {
        "BACKEND": "django.core.cache.backends.locmem.LocMemCache",
        "KEY_FUNCTION": "django_tenants.cache.make_key",
        "REVERSE_KEY_FUNCTION": "django_tenants.cache.reverse_key",
    },
    "shared": {
        "BACKEND": "django.core.cache.backends.locmem.LocMemCache",
        "LOCATION": "geocode-backoff-tests",
    },
}


class Response:
    """Minimal stand-in for a requests response."""

    def __init__(self, status_code=200, payload=None, headers=None):
        self.status_code = status_code
        self.headers = headers or {}
        self._payload = payload if payload is not None else []

    def json(self):
        return self._payload

    def raise_for_status(self):
        if self.status_code >= 400:
            raise AssertionError(f"HTTP {self.status_code}")


class Retrying(Exception):
    """Stands in for what Celery raises when a task reschedules itself."""


@override_settings(CACHES=SHARED_LOCMEM)
class GeocodingPauseTests(TenantTestCase):
    def setUp(self):
        caches["shared"].clear()
        # Saving an address queues the very task under test; keep it off the
        # broker while setting the fixture up.
        queueing = patch.object(tasks.geocode_location, "delay")
        queueing.start()
        self.addCleanup(queueing.stop)
        self.organisation = Organisation.objects.create(
            name="Cabinet", street="7 Parvis Corentin Celton",
            postal_code="92130", city="Issy-Les-Moulineaux", country="France",
        )

    def _geocode(self):
        return tasks.geocode_location(
            "users", "organisation", self.organisation.pk,
            connection.schema_name,
        )

    # ── The pause itself ────────────────────────────────────────────────

    def test_no_pause_by_default(self):
        self.assertEqual(tasks.geocoding_pause_remaining(), 0)

    def test_pause_is_observed(self):
        pause = tasks.pause_geocoding()

        self.assertEqual(pause, tasks.NOMINATIM_COOLDOWN_SECONDS)
        self.assertGreater(tasks.geocoding_pause_remaining(), 0)
        self.assertLessEqual(
            tasks.geocoding_pause_remaining(), tasks.NOMINATIM_COOLDOWN_SECONDS
        )

    def test_repeated_rate_limits_widen_the_pause(self):
        first = tasks.pause_geocoding()
        second = tasks.pause_geocoding()

        self.assertGreater(second, first)
        self.assertLessEqual(second, tasks.NOMINATIM_MAX_COOLDOWN_SECONDS)

    def test_pause_never_exceeds_the_ceiling(self):
        for _ in range(10):
            pause = tasks.pause_geocoding()

        self.assertEqual(pause, tasks.NOMINATIM_MAX_COOLDOWN_SECONDS)

    def test_retry_after_header_is_honoured(self):
        pause = tasks.pause_geocoding(retry_after="900")

        self.assertEqual(pause, 900)

    def test_unusable_retry_after_falls_back_on_the_default(self):
        pause = tasks.pause_geocoding(retry_after="soon")

        self.assertEqual(pause, tasks.NOMINATIM_COOLDOWN_SECONDS)

    # ── What the task does with it ──────────────────────────────────────

    def test_429_pauses_every_task_and_reschedules(self):
        response = Response(status_code=429)

        with patch.object(tasks.http_requests, "get", return_value=response), \
                patch.object(tasks.geocode_location, "retry",
                             side_effect=Retrying) as retry:
            with self.assertRaises(Retrying):
                self._geocode()

        self.assertGreater(tasks.geocoding_pause_remaining(), 0)
        countdown = retry.call_args.kwargs["countdown"]
        self.assertGreaterEqual(countdown, tasks.NOMINATIM_COOLDOWN_SECONDS)

    def test_paused_task_reschedules_without_calling_nominatim(self):
        tasks.pause_geocoding()

        with patch.object(tasks.http_requests, "get") as get, \
                patch.object(tasks.geocode_location, "retry",
                             side_effect=Retrying) as retry:
            with self.assertRaises(Retrying):
                self._geocode()

        get.assert_not_called()
        self.assertGreater(retry.call_args.kwargs["countdown"], 0)

    def test_wakeups_are_spread_out(self):
        """Every task coming back on the same second would earn a new 429."""
        tasks.pause_geocoding()
        countdowns = set()

        for _ in range(20):
            with patch.object(tasks.http_requests, "get"), \
                    patch.object(tasks.geocode_location, "retry",
                                 side_effect=Retrying) as retry:
                with self.assertRaises(Retrying):
                    self._geocode()
            countdowns.add(retry.call_args.kwargs["countdown"])

        self.assertGreater(len(countdowns), 1)

    def test_geocoding_resumes_once_the_pause_has_elapsed(self):
        caches["shared"].set(
            tasks.NOMINATIM_COOLDOWN_KEY, time.time() - 1, timeout=60
        )
        response = Response(payload=[{"lat": "48.82", "lon": "2.28"}])

        with patch.object(tasks.http_requests, "get", return_value=response):
            self._geocode()

        self.organisation.refresh_from_db()
        self.assertEqual(self.organisation.location, "48.82,2.28")
