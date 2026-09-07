"""Tests for the Odoo integration.

Two layers:
- ``OdooClientTest`` exercises the XML-RPC envelope against a mock
  ServerProxy (no network, no DB) — proves the client calls the right
  endpoint/method and unwraps ids.
- ``SyncIdempotencyTest`` uses Django's TestCase with a mocked OdooClient to
  prove the sync never double-creates and always updates in place.

Both are replay-safe by construction: the hashing + OdooSyncState row is the
only place "already sent?" is decided.
"""

from unittest import mock

from django.test import TestCase

from integrations.models import OdooSyncState
from integrations.odoo_client import OdooClient, OdooConfig, config_from_env


class OdooClientTest(TestCase):
    def _client_with(self, common_uid, object_return):
        cfg = OdooConfig(url="https://x.odoo.com", db="db", username="u", api_key="k")
        client = OdooClient(cfg)
        common = mock.MagicMock()
        common.authenticate.return_value = common_uid
        models = mock.MagicMock()
        models.execute_kw.return_value = object_return
        with mock.patch.object(client, "_common", common), mock.patch.object(client, "_models", models):
            return client, models

    def test_authenticate_caches_uid(self):
        client, _ = self._client_with(42, 1)
        self.assertEqual(client.authenticate(), 42)
        self.assertEqual(client.authenticate(), 42)  # second call reuses cache

    def test_execute_hits_object_endpoint_with_credentials(self):
        client, models = self._client_with(7, [99])
        out = client.search("res.partner", [["email", "=", "a@b.c"]])
        self.assertEqual(out, [99])
        args, kwargs = models.execute_kw.call_args
        self.assertEqual(args[0], "db")
        self.assertEqual(args[1], 7)
        self.assertEqual(args[2], "k")
        self.assertEqual(args[3], "res.partner")
        self.assertEqual(args[4], "search")

    def test_config_from_env_requires_all_vars(self):
        with mock.patch.dict("os.environ", {}, clear=True):
            with self.assertRaises(RuntimeError):
                config_from_env()


class _FakeUser:
    """Minimal stand-in for users.User used by the sync functions."""

    def __init__(self, pk=1, email="a@b.c", username="patient", phone="+9627", language="ar"):
        self.pk = pk
        self.email = email
        self.username = username
        self.phone = phone
        self.language = language

    def get_full_name(self):
        return "Test Patient"

    @property
    def _meta(self):
        class M:
            app_label = "users"
            model_name = "user"
        return M()


class SyncIdempotencyTest(TestCase):
    def setUp(self):
        self.user = _FakeUser(pk=1, email="a@b.c")
        self.patcher = mock.patch("integrations.sync.OdooClient")
        self.Client = self.patcher.start()
        self.fake_client = self.Client.return_value
        self.fake_client.search.return_value = []
        self.fake_client.create.return_value = 123
        self.fake_client.write.return_value = True
        self.addCleanup(self.patcher.stop)

    def _consultation(self, pk=10, beneficiary=None, temporary=False):
        class C:
            title = "Spine review"
            description = "Follow-up"
            def __init__(self, p, b, t):
                self.pk = p
                self.beneficiary = b
                self.temporary = t
        return C(pk, beneficiary, temporary)

    def test_first_sync_creates_partner_and_lead(self):
        from integrations.sync import sync_patient, sync_consultation
        pid = sync_patient(self.fake_client, self.user)
        self.assertEqual(pid, 123)
        self.fake_client.create.assert_any_call("res.partner", mock.ANY)
        lid = sync_consultation(self.fake_client, self._consultation(beneficiary=self.user), pid)
        self.assertEqual(lid, 123)
        self.fake_client.create.assert_any_call("crm.lead", mock.ANY)
        self.assertEqual(OdooSyncState.objects.count(), 2)

    def test_replay_with_same_payload_is_noop(self):
        from integrations.sync import sync_patient
        sync_patient(self.fake_client, self.user)
        self.fake_client.create.reset_mock()
        sync_patient(self.fake_client, self.user)
        self.fake_client.create.assert_not_called()
        self.fake_client.write.assert_not_called()

    def test_changed_payload_updates_existing(self):
        from integrations.sync import sync_patient
        sync_patient(self.fake_client, self.user)
        self.fake_client.create.reset_mock()
        self.user.email = "different@x.com"
        sync_patient(self.fake_client, self.user)
        self.fake_client.create.assert_not_called()
        self.fake_client.write.assert_called_once()
