from django.urls import reverse
from django_tenants.test.cases import TenantTestCase
from rest_framework.test import APIClient

from users.models import User


class PhoneNormalizationTests(TenantTestCase):
    def test_save_strips_spaces_and_separators(self):
        u = User.objects.create_user(
            email="p1@example.com",
                        mobile_phone_number="06 12 34 56 78",
        )
        u.refresh_from_db()
        self.assertEqual(u.mobile_phone_number, "0612345678")

    def test_save_keeps_leading_plus(self):
        u = User.objects.create_user(
            email="p2@example.com",
                        mobile_phone_number="+33 6 12.34-56(78)",
        )
        u.refresh_from_db()
        self.assertEqual(u.mobile_phone_number, "+33612345678")

    def test_blank_phone_number_stored_as_null(self):
        """Empty strings must become NULL so the unique constraint allows
        multiple users without a phone number."""
        u1 = User.objects.create_user(
            email="blank1@example.com", mobile_phone_number=""
        )
        u2 = User.objects.create_user(
            email="blank2@example.com", mobile_phone_number=""
        )
        u1.refresh_from_db()
        u2.refresh_from_db()
        self.assertIsNone(u1.mobile_phone_number)
        self.assertIsNone(u2.mobile_phone_number)


class PhoneSearchTests(TenantTestCase):
    def setUp(self):
        self.practitioner = User.objects.create_user(
            email="doc@example.com", is_practitioner=True
        )
        self.patient = User.objects.create_user(
            email="pat@example.com",
                        first_name="Jean",
            mobile_phone_number="06 12 34 56 78",  # stored normalized
        )
        self.client = APIClient()
        self.client.force_authenticate(user=self.practitioner)

    def _search(self, term):
        resp = self.client.get(reverse("user-list"), {"search": term})
        self.assertEqual(resp.status_code, 200)
        return [r["pk"] for r in resp.data["results"]]

    def test_search_without_spaces_matches_spaced_number(self):
        self.assertIn(self.patient.pk, self._search("0612345678"))

    def test_search_with_spaces_matches(self):
        self.assertIn(self.patient.pk, self._search("06 12 34 56 78"))

    def test_search_partial_number_matches(self):
        self.assertIn(self.patient.pk, self._search("123456"))

    def test_search_by_name_still_works(self):
        self.assertIn(self.patient.pk, self._search("Jean"))
