from constance.test import override_config
from django.urls import reverse
from django_tenants.test.cases import TenantTestCase
from rest_framework.test import APIClient

from django.core.exceptions import ValidationError
from django.db import IntegrityError, transaction

from users.models import User
from users.validators import validate_phone_number


@override_config(default_phone_region="FR")
class PhoneNormalizationTests(TenantTestCase):
    def test_save_normalizes_national_number_to_e164(self):
        u = User.objects.create_user(
            email="p1@example.com",
            mobile_phone_number="06 12 34 56 78",
        )
        u.refresh_from_db()
        self.assertEqual(u.mobile_phone_number, "+33612345678")

    def test_save_normalizes_international_number(self):
        u = User.objects.create_user(
            email="p2@example.com",
            mobile_phone_number="+33 6 12.34-56(78)",
        )
        u.refresh_from_db()
        self.assertEqual(u.mobile_phone_number, "+33612345678")

    def test_national_and_international_forms_are_the_same_number(self):
        """The whole point of storing E.164: the unique constraint must see
        '0612345678' and '+33612345678' as one number, not two."""
        User.objects.create_user(
            email="p3@example.com", mobile_phone_number="0612345678"
        )
        with self.assertRaises(IntegrityError):
            with transaction.atomic():
                User.objects.create_user(
                    email="p4@example.com", mobile_phone_number="+33 612 345 678"
                )

    def test_unparsable_number_keeps_legacy_form(self):
        """Numbers phonenumbers cannot make sense of must survive untouched
        rather than being dropped, so existing rows are never lost."""
        u = User.objects.create_user(
            email="p5@example.com", mobile_phone_number="12 34 56"
        )
        u.refresh_from_db()
        self.assertEqual(u.mobile_phone_number, "123456")

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


class PhoneValidationTests(TenantTestCase):
    """Without a default region, only the international notation is accepted."""

    @override_config(default_phone_region="")
    def test_national_number_rejected_without_default_region(self):
        with self.assertRaises(ValidationError) as ctx:
            validate_phone_number("06 12 34 56 78")
        self.assertEqual(ctx.exception.code, "phone_number_not_international")

    @override_config(default_phone_region="")
    def test_international_number_accepted_without_default_region(self):
        validate_phone_number("+33 6 12 34 56 78")

    @override_config(default_phone_region="FR")
    def test_national_number_accepted_with_default_region(self):
        validate_phone_number("06 12 34 56 78")

    @override_config(default_phone_region="FR")
    def test_free_text_rejected(self):
        with self.assertRaises(ValidationError) as ctx:
            validate_phone_number("abc")
        self.assertEqual(ctx.exception.code, "invalid_phone_number")

    @override_config(default_phone_region="")
    def test_blank_is_allowed(self):
        validate_phone_number("")
        validate_phone_number(None)


@override_config(default_phone_region="FR")
class PhoneLookupTests(TenantTestCase):
    """`get_or_create_by_phone` must reuse the account whatever the notation."""

    def test_get_or_create_matches_differently_typed_number(self):
        existing = User.objects.create_user(
            email="lookup@example.com", mobile_phone_number="+33612345678"
        )
        user, created = User.objects.get_or_create_by_phone("06 12 34 56 78")
        self.assertFalse(created)
        self.assertEqual(user.pk, existing.pk)

    def test_get_or_create_creates_canonical_row(self):
        user, created = User.objects.get_or_create_by_phone("06 12 34 56 79")
        self.assertTrue(created)
        user.refresh_from_db()
        self.assertEqual(user.mobile_phone_number, "+33612345679")

    def test_find_by_phone_matches_legacy_stored_form(self):
        """Rows written before the E.164 migration must still be found."""
        legacy = User.objects.create_user(email="legacy@example.com")
        User.objects.filter(pk=legacy.pk).update(mobile_phone_number="0612345670")
        self.assertEqual(User.objects.find_by_phone("0612345670").pk, legacy.pk)


@override_config(default_phone_region="FR")
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


class PhoneConfigTests(TenantTestCase):
    """The front-ends read the region from /api/config/ to decide whether a
    national number can be offered as an SMS invite."""

    def setUp(self):
        self.client = APIClient()

    @override_config(default_phone_region="FR")
    def test_config_exposes_region(self):
        resp = self.client.get(reverse("app_config"))
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.data["default_phone_region"], "FR")

    @override_config(default_phone_region="")
    def test_config_exposes_empty_region(self):
        resp = self.client.get(reverse("app_config"))
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.data["default_phone_region"], "")
