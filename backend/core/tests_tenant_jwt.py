"""A tenant's JWT must be refused by every other tenant of the instance.

All tenants of an instance sign their tokens with the same ``SECRET_KEY`` and
user ids are per-schema sequences, so a token issued by tenant A carries a
valid signature on tenant B and its ``user_id`` most likely exists there too.
The only thing telling the tenants apart is the ``tenant_id`` claim, which
``core.authentication.TenantJWTAuthentication`` compares with the tenant
resolved from the ``Host`` header. A view opting out of that class for the
tenant-blind ``rest_framework_simplejwt`` one accepts foreign tokens and
authenticates the caller as whoever has the same id locally (audit C-01).
"""
from django.test import SimpleTestCase
from django.urls import URLPattern, URLResolver, get_resolver, reverse
from django_tenants.test.cases import TenantTestCase
from rest_framework.settings import api_settings
from rest_framework.test import APIClient
from rest_framework.views import APIView
from rest_framework_simplejwt.authentication import JWTAuthentication
from rest_framework_simplejwt.tokens import RefreshToken

from core.authentication import TenantJWTAuthentication, TenantRefreshToken
from users.models import User


class CrossTenantTokenReplayTests(TenantTestCase):
    """Replays a foreign token on the endpoints that used to accept it."""

    def setUp(self):
        self.user = User.objects.create_user(email="patient@example.com")
        self.client = APIClient()

    def _endpoints(self):
        # The seven views that overrode ``authentication_classes`` with the
        # tenant-blind class. Bodies are irrelevant: authentication runs first.
        return [
            ("get", reverse("user-consultations-list")),
            ("get", reverse("user-appointments-list")),
            ("get", reverse("user_dashboard")),
            ("get", reverse("user_testrtc")),
            ("post", reverse("webpush_subscribe")),
            ("post", reverse("webpush_unsubscribe")),
            ("get", reverse("message_attachment", kwargs={"message_id": 1})),
        ]

    def _call(self, method, url, access_token):
        return getattr(self.client, method)(
            url, HTTP_AUTHORIZATION=f"Bearer {access_token}"
        )

    def _foreign_tenant_token(self):
        """What a user of another tenant holds: same signing key, an id that
        exists here as well, only the tenant claims differ."""
        access = TenantRefreshToken.for_user(self.user).access_token
        access["tenant_id"] = self.tenant.id + 1
        access["tenant_schema"] = "other_tenant"
        return str(access)

    def test_foreign_tenant_token_is_refused(self):
        token = self._foreign_tenant_token()
        for method, url in self._endpoints():
            with self.subTest(url=url):
                response = self._call(method, url, token)
                self.assertEqual(response.status_code, 401)

    def test_token_without_tenant_claim_is_refused(self):
        """Plain simplejwt tokens carry no tenant at all; refuse them too."""
        token = str(RefreshToken.for_user(self.user).access_token)
        for method, url in self._endpoints():
            with self.subTest(url=url):
                response = self._call(method, url, token)
                self.assertIn(response.status_code, (401, 403))

    def test_own_tenant_token_is_accepted(self):
        """Control: the rejections above come from the tenant check, not from
        a malformed token."""
        token = str(TenantRefreshToken.for_user(self.user).access_token)
        response = self._call("get", reverse("user_dashboard"), token)
        self.assertEqual(response.status_code, 200)


def _api_views(patterns, prefix=""):
    """Yield ``(route, view class)`` for every DRF view of a URLconf."""
    for entry in patterns:
        route = prefix + str(entry.pattern)
        if isinstance(entry, URLResolver):
            yield from _api_views(entry.url_patterns, route)
        elif isinstance(entry, URLPattern):
            # APIView.as_view() (and ViewSet.as_view()) keep the class on the
            # callback; plain Django views have no ``cls`` and are skipped.
            view = getattr(entry.callback, "cls", None)
            if isinstance(view, type) and issubclass(view, APIView):
                yield route, view


class TenantBlindJWTAuthenticationGuardTests(SimpleTestCase):
    """The audit's lint rule, as a test: no API view may validate JWTs
    without the tenant check.

    Any authentication class deriving from simplejwt's ``JWTAuthentication``
    has to be ``TenantJWTAuthentication`` (or a subclass of it). Views that
    leave ``authentication_classes`` alone inherit it from
    ``REST_FRAMEWORK["DEFAULT_AUTHENTICATION_CLASSES"]``.
    """

    def test_every_api_view_checks_the_tenant_of_a_jwt(self):
        api_views = list(_api_views(get_resolver().url_patterns))

        # An empty walk would pass vacuously: make sure it reaches at least the
        # views that used to opt out of the tenant check.
        from users import views as user_views

        audited = {
            user_views.UserConsultationsViewSet,
            user_views.UserAppointmentsViewSet,
            user_views.UserDashboardView,
            user_views.TestRTCView,
            user_views.WebPushSubscribeView,
            user_views.WebPushUnsubscribeView,
            user_views.MessageAttachmentView,
        }
        self.assertLessEqual(audited, {view for _, view in api_views})

        offenders = [
            f"{route} -> {view.__name__} uses {auth.__name__}"
            for route, view in api_views
            for auth in view.authentication_classes
            if issubclass(auth, JWTAuthentication)
            and not issubclass(auth, TenantJWTAuthentication)
        ]
        self.assertEqual(offenders, [], "\n".join(offenders))

    def test_the_defaults_are_tenant_aware(self):
        """The guard above relies on the DRF defaults being safe."""
        self.assertIn(
            TenantJWTAuthentication, api_settings.DEFAULT_AUTHENTICATION_CLASSES
        )
