"""Tests for sign-up and account verification by 6-digit code.

Sign-up takes one identifier — an email address or a phone number — and mails
or texts a code. Typing that code back claims the account and signs the person
in. The code lives in the same fields as the passwordless login one, so these
tests also pin the behaviours that keep the two flows from weakening each
other.
"""

from datetime import timedelta

from constance.test import override_config
from django.core.cache import cache
from django.utils import timezone
from django_tenants.test.cases import TenantTestCase
from rest_framework.test import APIClient

from messaging.models import CommunicationMethod, Message, MessagingProvider
from users.models import User
from users.verification import (
    MAX_VERIFICATION_ATTEMPTS,
    VERIFICATION_CODE_RESEND_DELAY,
    VERIFICATION_CODE_REUSE_WINDOW,
    VERIFICATION_CODE_TTL,
)

REGISTER_URL = "/api/auth/registration/"
VERIFY_URL = "/api/auth/verify/"
RESEND_URL = "/api/auth/verify/resend/"
SEND_CODE_URL = "/api/auth/send-verification-code/"
TOKEN_URL = "/api/auth/token/"
INVALID = "Invalid or expired verification code."
SIGN_UP_TEMPLATE = "email_verification"
SIGN_IN_TEMPLATE = "your_authentication_code"


def enable_sms():
    """Give the tenant an active SMS provider, as phone sign-up requires.

    ``name`` must match a module under messaging/providers: MessagingProvider
    .save() reads the channel off that class rather than off the field.
    """
    MessagingProvider.objects.create(name="smsmode", is_active=True)


def backdate(user, **ages):
    """Pretend ``verification_code_<name>_at`` was set ``ages[name]`` ago.

    Goes through a queryset update: ``save()`` would mint a token for a
    temporary user on the way.
    """
    now = timezone.now()
    User.objects.filter(pk=user.pk).update(
        **{f"verification_code_{name}_at": now - age for name, age in ages.items()}
    )
    user.refresh_from_db()


PAST_RESEND_DELAY = VERIFICATION_CODE_RESEND_DELAY + timedelta(seconds=1)
PAST_REUSE_WINDOW = VERIFICATION_CODE_REUSE_WINDOW + timedelta(seconds=1)


class SignUpTests(TenantTestCase):
    def setUp(self):
        super().setUp()
        # Throttles are cache-backed and would otherwise leak across tests.
        cache.clear()
        self.client = APIClient()

    def register(self, identifier):
        return self.client.post(
            REGISTER_URL, data={"identifier": identifier}, format="json"
        )

    @override_config(enable_registration=True)
    def test_email_sign_up_issues_a_code(self):
        response = self.register("patient@example.org")

        self.assertEqual(response.status_code, 201, response.data)
        user = User.objects.get(email="patient@example.org")
        self.assertIsNotNone(user.verification_code)
        self.assertFalse(user.email_verified)
        self.assertFalse(user.is_active)
        self.assertEqual(user.communication_method, CommunicationMethod.email)
        # Without a token there is no way into AnonymousTokenAuthView, so the
        # code cannot be traded for a session through the grace period.
        self.assertIsNone(user.one_time_auth_token)

        message = Message.objects.get(sent_to=user)
        self.assertEqual(message.template_system_name, SIGN_UP_TEMPLATE)
        self.assertEqual(message.communication_method, CommunicationMethod.email)
        self.assertIn(str(user.verification_code), message.render_content)
        self.assertIsNone(message.access_link)

    @override_config(enable_registration=True)
    def test_phone_sign_up_stores_e164_and_texts_the_code(self):
        enable_sms()

        response = self.register("+33 6 12 34 56 78")

        self.assertEqual(response.status_code, 201, response.data)
        user = User.objects.get(mobile_phone_number="+33612345678")
        self.assertIsNone(user.email)
        self.assertEqual(user.communication_method, CommunicationMethod.sms)
        self.assertIsNotNone(user.verification_code)

        message = Message.objects.get(sent_to=user)
        self.assertEqual(message.template_system_name, SIGN_UP_TEMPLATE)
        self.assertEqual(message.communication_method, CommunicationMethod.sms)

    @override_config(enable_registration=True)
    def test_national_phone_needs_a_default_region(self):
        enable_sms()

        response = self.register("0612345678")
        self.assertEqual(response.status_code, 400)

        with override_config(default_phone_region="FR"):
            response = self.register("0612345678")

        self.assertEqual(response.status_code, 201, response.data)
        self.assertTrue(
            User.objects.filter(mobile_phone_number="+33612345678").exists()
        )

    @override_config(enable_registration=True)
    def test_phone_sign_up_refused_without_an_sms_provider(self):
        response = self.register("+33612345678")

        self.assertEqual(response.status_code, 400)
        self.assertFalse(User.objects.filter(email__isnull=True).exists())

    @override_config(enable_registration=True)
    def test_existing_identifier_does_not_leak(self):
        User.objects.create(email="patient@example.org")

        response = self.register("patient@example.org")

        self.assertEqual(response.status_code, 201, response.data)
        self.assertEqual(User.objects.filter(email="patient@example.org").count(), 1)

    @override_config(enable_registration=True)
    def test_signing_up_again_on_a_verified_account_still_sends_a_code(self):
        """Otherwise the person waits on the code screen for nothing."""
        user = User.objects.create(email="patient@example.org", email_verified=True)

        response = self.register("patient@example.org")

        self.assertEqual(response.status_code, 201, response.data)
        user.refresh_from_db()
        self.assertIsNotNone(user.verification_code)
        # A claimed account is signing in: "finish creating your account"
        # would be plainly wrong wording to send them.
        message = Message.objects.get(sent_to=user)
        self.assertEqual(message.template_system_name, SIGN_IN_TEMPLATE)
        self.assertIn(str(user.verification_code), message.render_content)

    @override_config(enable_registration=True)
    def test_signing_up_again_signs_the_owner_in(self):
        user = User.objects.create(
            email="patient@example.org", email_verified=True, last_login=timezone.now()
        )

        self.assertEqual(self.register(user.email).status_code, 201)
        user.refresh_from_db()

        response = self.client.post(
            VERIFY_URL,
            data={"identifier": user.email, "code": user.verification_code},
            format="json",
        )

        self.assertEqual(response.status_code, 200, response.data)
        self.assertIn("access", response.data)

    @override_config(enable_registration=True)
    def test_practitioners_get_no_code(self):
        """The verify endpoint refuses them, so the message would be useless."""
        user = User.objects.create(
            email="doctor@example.org", is_practitioner=True
        )

        self.assertEqual(self.register(user.email).status_code, 201)

        user.refresh_from_db()
        self.assertIsNone(user.verification_code)
        self.assertFalse(
            Message.objects.exists()
        )

    @override_config(enable_registration=True)
    def test_code_follows_the_identifier_not_the_account(self):
        """A known email contact signing up with their phone gets a text."""
        enable_sms()
        User.objects.create(
            email="patient@example.org",
            mobile_phone_number="+33612345678",
            communication_method=CommunicationMethod.email,
        )

        self.assertEqual(self.register("+33612345678").status_code, 201)

        message = Message.objects.get()
        self.assertEqual(message.communication_method, CommunicationMethod.sms)

    def test_registration_disabled_by_default(self):
        self.assertEqual(self.register("patient@example.org").status_code, 403)


class AccountVerifyTests(TenantTestCase):
    def setUp(self):
        super().setUp()
        cache.clear()
        self.client = APIClient()

    def make_user(self, **kwargs):
        kwargs.setdefault("email", "patient@example.org")
        kwargs.setdefault("is_active", False)
        user = User.objects.create(**kwargs)
        user.issue_verification_code()
        return user

    def verify(self, identifier, code):
        return self.client.post(
            VERIFY_URL, data={"identifier": identifier, "code": code}, format="json"
        )

    def test_correct_code_claims_the_account_and_signs_in(self):
        user = self.make_user()

        response = self.verify(user.email, user.verification_code)

        self.assertEqual(response.status_code, 200, response.data)
        self.assertIn("access", response.data)
        self.assertIn("refresh", response.data)
        user.refresh_from_db()
        self.assertTrue(user.email_verified)
        self.assertTrue(user.is_active)
        self.assertFalse(user.temporary)
        self.assertIsNone(user.verification_code)

    def test_verifying_by_phone_switches_the_preferred_channel(self):
        """Onboarding must offer back the channel they actually chose."""
        user = self.make_user(
            email="patient@example.org",
            mobile_phone_number="+33612345678",
            communication_method=CommunicationMethod.email,
        )

        response = self.verify("+33612345678", user.verification_code)

        self.assertEqual(response.status_code, 200, response.data)
        user.refresh_from_db()
        self.assertEqual(user.communication_method, CommunicationMethod.sms)
        # Only the channel they proved they own counts as verified.
        self.assertFalse(user.email_verified)

    def test_verifying_by_email_switches_the_preferred_channel(self):
        user = self.make_user(
            email="patient@example.org",
            mobile_phone_number="+33612345678",
            communication_method=CommunicationMethod.sms,
        )

        response = self.verify(user.email, user.verification_code)

        self.assertEqual(response.status_code, 200, response.data)
        user.refresh_from_db()
        self.assertEqual(user.communication_method, CommunicationMethod.email)
        self.assertTrue(user.email_verified)

    def test_phone_identifier_is_matched_across_formats(self):
        user = self.make_user(email=None, mobile_phone_number="+33612345678")

        response = self.verify("+33 6 12 34 56 78", user.verification_code)

        self.assertEqual(response.status_code, 200, response.data)
        user.refresh_from_db()
        self.assertTrue(user.is_active)

    def test_email_is_matched_case_insensitively(self):
        user = self.make_user(email="Eugene.Paik@toronto.msf.org")

        response = self.verify("eugene.paik@TORONTO.msf.org", user.verification_code)

        self.assertEqual(response.status_code, 200, response.data)

    def test_a_verified_account_still_needs_the_right_code(self):
        """The 'already verified' shortcut must not hand out a free session."""
        user = self.make_user()
        self.assertEqual(self.verify(user.email, user.verification_code).status_code, 200)

        response = self.verify(user.email, 123456)

        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.data["detail"], INVALID)
        self.assertNotIn("access", response.data)

    def test_wrong_code_counts_an_attempt(self):
        user = self.make_user()

        response = self.verify(user.email, user.verification_code + 1)

        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.data["detail"], INVALID)
        user.refresh_from_db()
        self.assertEqual(user.verification_attempts, 1)

    def test_code_is_burnt_after_the_last_allowed_attempt(self):
        user = self.make_user()
        correct = user.verification_code

        for _ in range(MAX_VERIFICATION_ATTEMPTS):
            self.assertEqual(self.verify(user.email, correct + 1).status_code, 400)

        user.refresh_from_db()
        self.assertIsNone(user.verification_code)

        # Even the right code is worthless now: a fresh one has to be requested.
        self.assertEqual(self.verify(user.email, correct).status_code, 400)

    def test_expired_code_is_rejected(self):
        user = self.make_user()
        backdate(user, issued=VERIFICATION_CODE_TTL + timedelta(minutes=1))

        self.assertEqual(
            self.verify(user.email, user.verification_code).status_code, 400
        )

    def test_unknown_identifier_answers_like_a_wrong_code(self):
        response = self.verify("nobody@example.org", 123456)

        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.data["detail"], INVALID)

    def test_practitioners_cannot_sign_in_here(self):
        """This route must not become a way around the SSO-only policy."""
        user = self.make_user(is_practitioner=True)

        response = self.verify(user.email, user.verification_code)

        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.data["detail"], INVALID)

    def test_a_disabled_account_is_not_brought_back(self):
        user = self.make_user()
        user.last_login = timezone.now()
        user.save(update_fields=["last_login"])

        response = self.verify(user.email, user.verification_code)

        self.assertEqual(response.status_code, 400)
        user.refresh_from_db()
        self.assertFalse(user.is_active)

    def test_temporary_account_keeps_no_auth_token(self):
        """save() mints a token for temporary users; issuing a code must not."""
        user = User.objects.create(email="patient@example.org", temporary=True)

        user.issue_verification_code()

        user.refresh_from_db()
        self.assertIsNone(user.one_time_auth_token)


class VerificationResendTests(TenantTestCase):
    def setUp(self):
        super().setUp()
        cache.clear()
        self.client = APIClient()

    def resend(self, identifier):
        return self.client.post(
            RESEND_URL, data={"identifier": identifier}, format="json"
        )

    def test_resend_sends_the_same_code_again(self):
        """Whichever message the person opens, the code in it must work."""
        user = User.objects.create(email="patient@example.org", is_active=False)
        user.issue_verification_code()
        previous = user.verification_code
        backdate(user, sent=PAST_RESEND_DELAY)

        response = self.resend(user.email)

        self.assertEqual(response.status_code, 200, response.data)
        user.refresh_from_db()
        self.assertEqual(user.verification_code, previous)
        message = Message.objects.get(sent_to=user)
        self.assertIn(str(previous), message.render_content)

    def test_resending_the_same_code_keeps_its_attempts(self):
        """Otherwise asking again would buy unlimited guesses on one code."""
        user = User.objects.create(email="patient@example.org", is_active=False)
        user.issue_verification_code()
        user.verification_attempts = 2
        user.save(update_fields=["verification_attempts"])
        backdate(user, sent=PAST_RESEND_DELAY)

        self.assertEqual(self.resend(user.email).status_code, 200)

        user.refresh_from_db()
        self.assertEqual(user.verification_attempts, 2)

    def test_resend_past_the_reuse_window_replaces_the_code(self):
        user = User.objects.create(email="patient@example.org", is_active=False)
        user.issue_verification_code()
        previous = user.verification_code
        user.verification_attempts = 2
        user.save(update_fields=["verification_attempts"])
        backdate(user, issued=PAST_REUSE_WINDOW, sent=PAST_REUSE_WINDOW)

        response = self.resend(user.email)

        self.assertEqual(response.status_code, 200, response.data)
        user.refresh_from_db()
        self.assertNotEqual(user.verification_code, previous)
        self.assertEqual(user.verification_attempts, 0)

    def test_resend_within_the_delay_sends_nothing(self):
        user = User.objects.create(email="patient@example.org", is_active=False)
        user.issue_verification_code()
        previous = user.verification_code

        response = self.resend(user.email)

        self.assertEqual(response.status_code, 200, response.data)
        user.refresh_from_db()
        self.assertEqual(user.verification_code, previous)
        self.assertFalse(Message.objects.exists())

    def test_resend_after_a_burnt_code_issues_a_new_one(self):
        user = User.objects.create(email="patient@example.org", is_active=False)
        user.issue_verification_code()
        previous = user.verification_code
        user.verification_attempts = MAX_VERIFICATION_ATTEMPTS
        user.save(update_fields=["verification_attempts"])

        self.assertEqual(self.resend(user.email).status_code, 200)

        user.refresh_from_db()
        self.assertNotEqual(user.verification_code, previous)
        self.assertEqual(user.verification_attempts, 0)
        self.assertTrue(Message.objects.filter(sent_to=user).exists())

    def test_resend_by_phone(self):
        user = User.objects.create(
            mobile_phone_number="+33612345678",
            communication_method=CommunicationMethod.sms,
            is_active=False,
        )
        user.issue_verification_code()
        backdate(user, sent=PAST_RESEND_DELAY)

        response = self.resend("+33 6 12 34 56 78")

        self.assertEqual(response.status_code, 200, response.data)
        message = Message.objects.get(sent_to=user)
        self.assertEqual(message.communication_method, CommunicationMethod.sms)

    def test_resend_to_an_unknown_identifier_sends_nothing(self):
        response = self.resend("nobody@example.org")

        self.assertEqual(response.status_code, 200)
        self.assertFalse(
            Message.objects.exists()
        )

    def test_resend_to_a_verified_account_still_sends(self):
        """A known account reaching this screen is signing in, not signing up."""
        user = User.objects.create(email="patient@example.org", email_verified=True)

        response = self.resend(user.email)

        self.assertEqual(response.status_code, 200)
        user.refresh_from_db()
        self.assertIsNotNone(user.verification_code)

    def test_an_invited_patient_still_gets_the_sign_up_wording(self):
        """A temporary account has not been claimed yet: it is finishing sign-up."""
        user = User.objects.create(email="patient@example.org", temporary=True)

        self.assertEqual(self.resend(user.email).status_code, 200)

        self.assertEqual(
            Message.objects.get(sent_to=user).template_system_name, SIGN_UP_TEMPLATE
        )

    def test_resend_to_a_practitioner_sends_nothing(self):
        user = User.objects.create(email="doctor@example.org", is_practitioner=True)

        response = self.resend(user.email)

        self.assertEqual(response.status_code, 200)
        user.refresh_from_db()
        self.assertIsNone(user.verification_code)


class PasswordlessFlowTests(TenantTestCase):
    """The magic-link and code flows share storage; neither may weaken the other."""

    def setUp(self):
        super().setUp()
        cache.clear()
        self.client = APIClient()

    def send_code(self, identifier):
        return self.client.post(
            SEND_CODE_URL, data={"identifier": identifier}, format="json"
        )

    def sign_in(self, auth_token, code=None):
        data = {"auth_token": auth_token}
        if code is not None:
            data["verification_code"] = str(code)
        return self.client.post(TOKEN_URL, data=data, format="json")

    def make_link(self, minted_ago, **kwargs):
        """An account holding a magic link minted ``minted_ago``."""
        kwargs.setdefault("email", "patient@example.org")
        user = User.objects.create(one_time_auth_token="magic-link", **kwargs)
        backdate(user, created=minted_ago)
        return user

    def test_login_code_flow_still_works_by_email(self):
        user = User.objects.create(email="patient@example.org")

        response = self.send_code(user.email)

        self.assertEqual(response.status_code, 200, response.data)
        user.refresh_from_db()
        self.assertIsNotNone(user.verification_code)
        response = self.sign_in(response.data["auth_token"], user.verification_code)
        self.assertEqual(response.status_code, 200, response.data)
        self.assertIn("access", response.data)

    def test_asking_for_a_code_never_hands_out_the_magic_link(self):
        """Nor replaces it: links and tabs already out must keep working."""
        user = self.make_link(minted_ago=timedelta(days=1))

        response = self.send_code(user.email)

        self.assertEqual(response.status_code, 200, response.data)
        self.assertNotEqual(response.data["auth_token"], "magic-link")
        user.refresh_from_db()
        self.assertEqual(user.one_time_auth_token, "magic-link")

    def test_asking_again_keeps_the_code_and_every_token_valid(self):
        """The demo failure: the first tab and the first message went dead."""
        user = User.objects.create(email="patient@example.org")
        first = self.send_code(user.email)
        user.refresh_from_db()
        code = user.verification_code
        backdate(user, sent=PAST_RESEND_DELAY)

        second = self.send_code(user.email)

        user.refresh_from_db()
        self.assertEqual(user.verification_code, code)
        self.assertEqual(
            Message.objects.filter(sent_to=user).count(), 2
        )
        self.assertEqual(second.status_code, 200, second.data)
        response = self.sign_in(first.data["auth_token"], code)
        self.assertEqual(response.status_code, 200, response.data)

    def test_asking_again_within_the_delay_sends_nothing(self):
        user = User.objects.create(email="patient@example.org")

        self.send_code(user.email)
        self.send_code(user.email)

        self.assertEqual(Message.objects.filter(sent_to=user).count(), 1)

    def test_asking_again_keeps_the_attempts(self):
        user = User.objects.create(email="patient@example.org")
        token = self.send_code(user.email).data["auth_token"]
        user.refresh_from_db()
        self.assertEqual(self.sign_in(token, user.verification_code + 1).status_code, 401)
        backdate(user, sent=PAST_RESEND_DELAY)

        self.send_code(user.email)

        user.refresh_from_db()
        self.assertEqual(user.verification_attempts, 1)

    def test_expired_code_gets_its_own_answer(self):
        user = User.objects.create(email="patient@example.org")
        token = self.send_code(user.email).data["auth_token"]
        user.refresh_from_db()
        backdate(user, issued=VERIFICATION_CODE_TTL + timedelta(minutes=1))

        response = self.sign_in(token, user.verification_code)

        self.assertEqual(response.status_code, 401, response.data)
        self.assertEqual(response.data["code"], "verification_code_expired")
        self.assertNotIn("access", response.data)

    def test_code_login_token_alone_never_signs_in(self):
        user = User.objects.create(email="patient@example.org")
        token = self.send_code(user.email).data["auth_token"]

        response = self.sign_in(token)

        self.assertEqual(response.status_code, 202, response.data)
        self.assertNotIn("access", response.data)

    def test_burning_the_code_does_not_open_a_session(self):
        """Address known, three wrong codes, then the token alone: no way in."""
        user = User.objects.create(email="patient@example.org")
        token = self.send_code(user.email).data["auth_token"]
        for _ in range(MAX_VERIFICATION_ATTEMPTS):
            self.client.post(
                VERIFY_URL,
                data={"identifier": user.email, "code": "000000"},
                format="json",
            )
        user.refresh_from_db()
        self.assertIsNone(user.verification_code)

        response = self.sign_in(token)

        self.assertNotIn("access", response.data)

    def test_a_code_issued_after_the_link_closes_its_grace_period(self):
        """Burning that code must not bring the link-only window back."""
        user = self.make_link(minted_ago=timedelta(minutes=1))
        self.send_code(user.email)
        for _ in range(MAX_VERIFICATION_ATTEMPTS):
            self.client.post(
                VERIFY_URL,
                data={"identifier": user.email, "code": "000000"},
                format="json",
            )

        response = self.sign_in("magic-link")

        self.assertEqual(response.status_code, 202, response.data)
        self.assertNotIn("access", response.data)

    def test_fresh_magic_link_still_signs_in_on_first_tap(self):
        self.make_link(minted_ago=timedelta(minutes=1))

        response = self.sign_in("magic-link")

        self.assertEqual(response.status_code, 200, response.data)
        self.assertIn("access", response.data)

    def test_magic_link_confirmed_with_its_code_works_alone_for_a_while(self):
        user = self.make_link(minted_ago=timedelta(days=1))
        self.assertEqual(self.sign_in("magic-link").status_code, 202)
        user.refresh_from_db()
        self.assertEqual(
            self.sign_in("magic-link", user.verification_code).status_code, 200
        )

        response = self.sign_in("magic-link")

        self.assertEqual(response.status_code, 200, response.data)

    def test_reopening_a_magic_link_resends_the_same_code(self):
        user = self.make_link(minted_ago=timedelta(days=1))
        self.assertEqual(self.sign_in("magic-link").status_code, 202)
        user.refresh_from_db()
        code = user.verification_code

        self.assertEqual(self.sign_in("magic-link").status_code, 202)
        self.assertEqual(Message.objects.filter(sent_to=user).count(), 1)
        backdate(user, sent=PAST_RESEND_DELAY)
        self.assertEqual(self.sign_in("magic-link").status_code, 202)

        user.refresh_from_db()
        self.assertEqual(user.verification_code, code)
        self.assertEqual(Message.objects.filter(sent_to=user).count(), 2)

    def test_invited_participant_keeps_their_link_when_a_code_is_asked(self):
        user = self.make_link(minted_ago=timedelta(minutes=1), temporary=True)

        response = self.send_code(user.email)

        self.assertNotIn("auth_token", response.data)
        user.refresh_from_db()
        self.assertEqual(user.one_time_auth_token, "magic-link")

    def test_login_code_flow_works_by_phone(self):
        """Without this, an account created by phone could never sign back in."""
        user = User.objects.create(
            mobile_phone_number="+33612345678",
            communication_method=CommunicationMethod.sms,
        )

        response = self.send_code("+33 6 12 34 56 78")

        self.assertEqual(response.status_code, 200, response.data)
        user.refresh_from_db()
        self.assertIsNotNone(user.verification_code)

    def test_legacy_email_field_still_accepted(self):
        user = User.objects.create(email="patient@example.org")

        response = self.client.post(
            SEND_CODE_URL, data={"email": user.email}, format="json"
        )

        self.assertEqual(response.status_code, 200, response.data)

    def test_manual_account_is_never_handed_its_token(self):
        """Otherwise this response plus one request would take the account over."""
        user = User.objects.create(
            email="patient@example.org",
            communication_method=CommunicationMethod.manual,
        )

        response = self.send_code(user.email)

        self.assertEqual(response.status_code, 200, response.data)
        self.assertNotIn("auth_token", response.data)

    def test_phone_account_must_still_provide_a_code(self):
        """An account reachable by SMS is no longer treated as manual access."""
        self.make_link(
            minted_ago=timedelta(days=1),
            email=None,
            mobile_phone_number="+33612345678",
            communication_method=CommunicationMethod.sms,
        )

        response = self.sign_in("magic-link")

        self.assertEqual(response.status_code, 202, response.data)
        self.assertTrue(response.data.get("requires_verification"))

    def test_invited_participant_still_gets_in_without_a_code(self):
        """Invitations are a link and nothing else; do not add a step to them."""
        user = User.objects.create(
            mobile_phone_number="+33612345678",
            communication_method=CommunicationMethod.sms,
            temporary=True,
        )
        user.refresh_from_db()

        response = self.client.post(
            TOKEN_URL, data={"auth_token": user.one_time_auth_token}, format="json"
        )

        self.assertEqual(response.status_code, 200, response.data)
        self.assertIn("access", response.data)


class EmailChangeTests(TenantTestCase):
    """Changing the address must not carry the verified flag onto it."""

    def setUp(self):
        super().setUp()
        cache.clear()
        self.client = APIClient()

    def test_changing_the_address_clears_the_verified_flag(self):
        from users.serializers import UserDetailsSerializer

        user = User.objects.create(email="patient@example.org", email_verified=True)

        serializer = UserDetailsSerializer(
            user, data={"email": "someone.else@example.org"}, partial=True
        )
        self.assertTrue(serializer.is_valid(), serializer.errors)
        serializer.save()

        user.refresh_from_db()
        self.assertFalse(user.email_verified)

    def test_saving_the_same_address_keeps_it(self):
        from users.serializers import UserDetailsSerializer

        user = User.objects.create(email="patient@example.org", email_verified=True)

        serializer = UserDetailsSerializer(
            user, data={"email": "Patient@example.org"}, partial=True
        )
        self.assertTrue(serializer.is_valid(), serializer.errors)
        serializer.save()

        user.refresh_from_db()
        self.assertTrue(user.email_verified)
