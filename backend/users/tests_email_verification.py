"""Tests for the code-based email verification flow.

Registration mails a 6-digit code instead of a link. The code is stored in the
same fields as the passwordless login one, so these tests also pin the
behaviours that keep the two flows from bleeding into each other.
"""

from datetime import timedelta

from constance.test import override_config
from django.core.cache import cache
from django.utils import timezone
from django_tenants.test.cases import TenantTestCase
from rest_framework.test import APIClient

from messaging.models import Message
from users.models import User
from users.verification import EMAIL_VERIFICATION_CODE_TTL, MAX_VERIFICATION_ATTEMPTS

REGISTER_URL = "/api/auth/registration/"
VERIFY_URL = "/api/auth/verify-email/"
RESEND_URL = "/api/auth/verify-email/resend/"
INVALID = "Invalid or expired verification code."


class EmailVerificationTests(TenantTestCase):
    def setUp(self):
        super().setUp()
        # Throttles are cache-backed and would otherwise leak across tests.
        cache.clear()
        self.client = APIClient()

    def register(self, email="patient@example.org"):
        response = self.client.post(
            REGISTER_URL,
            data={
                "email": email,
                "password1": "S3cret-passphrase",
                "password2": "S3cret-passphrase",
            },
            format="json",
        )
        self.assertEqual(response.status_code, 201, response.data)
        return User.objects.get(email=email)

    def make_user(self, email="patient@example.org", **kwargs):
        user = User.objects.create_user(email=email, is_active=False, **kwargs)
        user.issue_email_verification_code()
        return user

    def verify(self, email, code):
        return self.client.post(
            VERIFY_URL, data={"email": email, "code": code}, format="json"
        )

    @override_config(enable_registration=True)
    def test_registration_issues_a_code_and_no_link(self):
        user = self.register()

        self.assertIsNotNone(user.verification_code)
        self.assertFalse(user.email_verified)
        self.assertFalse(user.is_active)
        # Without a token there is no way into AnonymousTokenAuthView, so the
        # code cannot be traded for a session through the grace period.
        self.assertIsNone(user.one_time_auth_token)

        message = Message.objects.get(
            sent_to=user, template_system_name="email_verification"
        )
        self.assertIsNone(message.additionnal_link_args)
        self.assertIsNone(message.access_link)

    @override_config(enable_registration=True)
    def test_message_carries_the_code(self):
        user = self.register()
        message = Message.objects.get(
            sent_to=user, template_system_name="email_verification"
        )
        code = str(user.verification_code)

        self.assertIn(code, message.render_content)
        self.assertIn(code, message.render_content_html)
        # SMS/WhatsApp render appends the access link only when there is an
        # action label; there is none any more, so the code stands alone.
        self.assertIn(code, message.render_content_sms)
        self.assertNotIn("http", message.render_content_sms)

    def test_correct_code_verifies_and_activates(self):
        user = self.make_user()

        response = self.verify(user.email, user.verification_code)

        self.assertEqual(response.status_code, 200, response.data)
        user.refresh_from_db()
        self.assertTrue(user.email_verified)
        self.assertTrue(user.is_active)
        self.assertIsNone(user.verification_code)
        self.assertEqual(user.verification_attempts, 0)

    def test_code_is_matched_case_insensitively_on_the_address(self):
        user = self.make_user(email="Eugene.Paik@toronto.msf.org")

        response = self.verify("eugene.paik@TORONTO.msf.org", user.verification_code)

        self.assertEqual(response.status_code, 200, response.data)
        user.refresh_from_db()
        self.assertTrue(user.email_verified)

    def test_wrong_code_counts_an_attempt(self):
        user = self.make_user()
        wrong = user.verification_code + 1

        response = self.verify(user.email, wrong)

        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.data["detail"], INVALID)
        user.refresh_from_db()
        self.assertEqual(user.verification_attempts, 1)
        self.assertFalse(user.email_verified)

    def test_code_is_burnt_after_the_last_allowed_attempt(self):
        user = self.make_user()
        correct = user.verification_code

        for _ in range(MAX_VERIFICATION_ATTEMPTS):
            self.assertEqual(self.verify(user.email, correct + 1).status_code, 400)

        user.refresh_from_db()
        self.assertIsNone(user.verification_code)

        # Even the right code is worthless now: a fresh one has to be requested.
        response = self.verify(user.email, correct)
        self.assertEqual(response.status_code, 400)
        user.refresh_from_db()
        self.assertFalse(user.email_verified)

    def test_expired_code_is_rejected(self):
        user = self.make_user()
        user.verification_code_created_at = (
            timezone.now() - EMAIL_VERIFICATION_CODE_TTL - timedelta(minutes=1)
        )
        user.save(update_fields=["verification_code_created_at"])

        response = self.verify(user.email, user.verification_code)

        self.assertEqual(response.status_code, 400)
        user.refresh_from_db()
        self.assertFalse(user.email_verified)

    def test_unknown_address_answers_like_a_wrong_code(self):
        response = self.verify("nobody@example.org", 123456)

        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.data["detail"], INVALID)

    def test_verifying_twice_is_harmless(self):
        user = self.make_user()
        self.assertEqual(self.verify(user.email, user.verification_code).status_code, 200)

        response = self.verify(user.email, 123456)

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["detail"], "Email already verified.")


class EmailVerificationResendTests(TenantTestCase):
    def setUp(self):
        super().setUp()
        cache.clear()
        self.client = APIClient()

    def resend(self, email):
        return self.client.post(RESEND_URL, data={"email": email}, format="json")

    def test_resend_replaces_the_code_and_clears_attempts(self):
        user = User.objects.create_user(email="patient@example.org", is_active=False)
        user.issue_email_verification_code()
        previous = user.verification_code
        user.verification_attempts = 2
        user.save(update_fields=["verification_attempts"])

        response = self.resend(user.email)

        self.assertEqual(response.status_code, 200, response.data)
        user.refresh_from_db()
        self.assertNotEqual(user.verification_code, previous)
        self.assertEqual(user.verification_attempts, 0)
        self.assertEqual(
            Message.objects.filter(
                sent_to=user, template_system_name="email_verification"
            ).count(),
            1,
        )

    def test_resend_to_an_unknown_address_sends_nothing(self):
        response = self.resend("nobody@example.org")

        self.assertEqual(response.status_code, 200)
        self.assertFalse(
            Message.objects.filter(template_system_name="email_verification").exists()
        )

    def test_resend_to_a_verified_address_sends_nothing(self):
        user = User.objects.create_user(email="patient@example.org")
        user.email_verified = True
        user.save(update_fields=["email_verified"])

        response = self.resend(user.email)

        self.assertEqual(response.status_code, 200)
        self.assertFalse(
            Message.objects.filter(template_system_name="email_verification").exists()
        )


class PasswordlessFlowIsolationTests(TenantTestCase):
    """The two code flows share storage; neither may weaken the other."""

    def setUp(self):
        super().setUp()
        cache.clear()
        self.client = APIClient()

    def test_login_code_flow_still_works(self):
        user = User.objects.create_user(email="patient@example.org")

        response = self.client.post(
            "/api/auth/send-verification-code/",
            data={"email": user.email},
            format="json",
        )

        self.assertEqual(response.status_code, 200, response.data)
        user.refresh_from_db()
        self.assertIsNotNone(user.verification_code)
        self.assertEqual(response.data["auth_token"], user.one_time_auth_token)

    def test_email_code_cannot_be_traded_for_a_session(self):
        user = User.objects.create_user(email="patient@example.org")
        user.one_time_auth_token = "a-token-from-an-earlier-message"
        user.save(update_fields=["one_time_auth_token"])

        user.issue_email_verification_code()

        # The token the attacker held is gone, so the grace period that
        # verification_code_created_at just opened is unreachable.
        response = self.client.post(
            "/api/auth/token/",
            data={"auth_token": "a-token-from-an-earlier-message"},
            format="json",
        )
        self.assertEqual(response.status_code, 401)
