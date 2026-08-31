from constance.test import override_config
from django.urls import reverse
from django_tenants.test.cases import TenantTestCase
from rest_framework.test import APIClient

from consultations.models import BookingSlot
from users.models import Organisation, User


GENEVA = "46.20,6.14"
LYON = "45.76,4.83"
# A box around Geneva, tight enough to leave Lyon out.
GENEVA_BOX = {
    "lat_min": "46.0",
    "lat_max": "46.4",
    "lng_min": "5.9",
    "lng_max": "6.4",
}


@override_config(public_organisations=True)
class MapHasSlotsTests(TenantTestCase):
    """The `has_slots` filter is about online booking, which only a
    practitioner can offer. An organisation holds no slot of its own, so it
    must never come back through a search narrowed that way."""

    def setUp(self):
        super().setUp()
        self.client = APIClient()
        self.url = reverse("map")

        self.org = Organisation.objects.create(
            name="Clinique du Centre",
            location=GENEVA,
            city="Geneva",
        )

        self.bookable = User.objects.create_user(
            email="bookable@example.com",
            is_practitioner=True,
            location=GENEVA,
        )
        BookingSlot.objects.create(
            created_by=self.bookable,
            user=self.bookable,
            monday=True,
            tuesday=True,
            wednesday=True,
            thursday=True,
            friday=True,
            saturday=False,
            sunday=False,
        )

        self.without_slots = User.objects.create_user(
            email="nobooking@example.com",
            is_practitioner=True,
            location=GENEVA,
        )

    def test_has_slots_returns_no_organisation(self):
        response = self.client.get(self.url, {"has_slots": "true"})

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["organisations"], [])
        self.assertEqual(
            [p["email"] for p in response.data["practitioners"]],
            ["bookable@example.com"],
        )

    def test_has_slots_drops_organisations_matching_the_search(self):
        """A facility whose name matches is still dropped: the filter rules
        out the whole category, not just the ones the terms missed."""
        response = self.client.get(
            self.url, {"has_slots": "true", "search": "Clinique"}
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["organisations"], [])

    def test_organisations_still_returned_without_the_filter(self):
        response = self.client.get(self.url)

        self.assertEqual(response.status_code, 200)
        self.assertEqual(
            [o["name"] for o in response.data["organisations"]],
            ["Clinique du Centre"],
        )


@override_config(public_organisations=True)
class MapBoundsTests(TenantTestCase):
    """Panning the map re-runs the search over the visible area, so the box
    has to narrow the terms instead of being dropped as soon as one is given."""

    def setUp(self):
        super().setUp()
        self.client = APIClient()
        self.url = reverse("map")

        self.geneva_org = Organisation.objects.create(
            name="Clinique Alpha", location=GENEVA, city="Geneva"
        )
        self.lyon_org = Organisation.objects.create(
            name="Clinique Alpha Lyon", location=LYON, city="Lyon"
        )

        self.geneva_doc = User.objects.create_user(
            email="geneva@example.com",
            last_name="Alpha",
            is_practitioner=True,
            location=GENEVA,
        )
        self.lyon_doc = User.objects.create_user(
            email="lyon@example.com",
            last_name="Alpha",
            is_practitioner=True,
            location=LYON,
        )

    def test_bounds_narrow_a_text_search(self):
        response = self.client.get(self.url, {"search": "Alpha", **GENEVA_BOX})

        self.assertEqual(response.status_code, 200)
        self.assertEqual(
            [o["name"] for o in response.data["organisations"]], ["Clinique Alpha"]
        )
        self.assertEqual(
            [p["email"] for p in response.data["practitioners"]],
            ["geneva@example.com"],
        )

    def test_search_without_bounds_still_spans_everything(self):
        response = self.client.get(self.url, {"search": "Alpha"})

        self.assertEqual(response.status_code, 200)
        self.assertEqual(len(response.data["organisations"]), 2)
        self.assertEqual(len(response.data["practitioners"]), 2)

    def test_bounds_use_the_main_organisation_when_the_user_has_no_location(self):
        """The map places such a practitioner on their organisation, so the box
        has to judge them on the very same point."""
        User.objects.create_user(
            email="hosted@example.com",
            last_name="Alpha",
            is_practitioner=True,
            main_organisation=self.geneva_org,
        )

        response = self.client.get(self.url, {"search": "Alpha", **GENEVA_BOX})

        self.assertEqual(response.status_code, 200)
        self.assertIn(
            "hosted@example.com",
            [p["email"] for p in response.data["practitioners"]],
        )

    def test_bounds_alone_still_filter(self):
        response = self.client.get(self.url, GENEVA_BOX)

        self.assertEqual(response.status_code, 200)
        self.assertEqual(
            [o["name"] for o in response.data["organisations"]], ["Clinique Alpha"]
        )
        self.assertEqual(
            [p["email"] for p in response.data["practitioners"]],
            ["geneva@example.com"],
        )
