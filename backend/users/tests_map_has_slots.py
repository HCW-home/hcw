from constance.test import override_config
from django.urls import reverse
from django_tenants.test.cases import TenantTestCase
from rest_framework.test import APIClient

from consultations.models import BookingSlot
from users.models import Organisation, User


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
            location="46.20,6.14",
            city="Geneva",
        )

        self.bookable = User.objects.create_user(
            email="bookable@example.com",
            is_practitioner=True,
            location="46.20,6.14",
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
            location="46.20,6.14",
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
