import uuid
from unittest.mock import patch

from django.core.cache import cache
from django_tenants.test.cases import TenantTestCase

from .exceptions import NoMediaServerAvailable
from .factories import ServerFactory
from .models import Server


class _AlwaysOK:
    def test_connection(self):
        return True, True


class _AlwaysFail:
    def test_connection(self):
        raise RuntimeError("unreachable")


def _all_ok_property():
    return property(lambda self: _AlwaysOK())


def _selective_property(failing_pk):
    def _getter(self):
        return _AlwaysFail() if self.pk == failing_pk else _AlwaysOK()
    return property(_getter)


class ServerPinningTests(TenantTestCase):
    def setUp(self):
        cache.clear()
        self.s1 = ServerFactory()
        self.s2 = ServerFactory()

    def tearDown(self):
        cache.clear()

    def test_pinning_returns_same_server_for_same_room(self):
        room_uuid = uuid.uuid4()
        with patch.object(Server, "instance", new_callable=_all_ok_property):
            first = Server.get_or_pin_for_room(room_uuid)
            second = Server.get_or_pin_for_room(room_uuid)
        self.assertEqual(first.pk, second.pk)

    def test_pinning_distinct_rooms_advance_round_robin(self):
        with patch.object(Server, "instance", new_callable=_all_ok_property):
            a = Server.get_or_pin_for_room(uuid.uuid4())
            b = Server.get_or_pin_for_room(uuid.uuid4())
        self.assertNotEqual(a.pk, b.pk)

    def test_pinned_server_becomes_unreachable_triggers_repick(self):
        room_uuid = uuid.uuid4()
        with patch.object(Server, "instance", new_callable=_all_ok_property):
            pinned = Server.get_or_pin_for_room(room_uuid)

        prop = _selective_property(pinned.pk)
        with patch.object(Server, "instance", new_callable=lambda: prop):
            repick = Server.get_or_pin_for_room(room_uuid)
        self.assertNotEqual(repick.pk, pinned.pk)

    def test_no_active_server_raises(self):
        Server.objects.update(is_active=False)
        with self.assertRaises(NoMediaServerAvailable):
            Server.get_or_pin_for_room(uuid.uuid4())

    def test_get_server_raises_when_all_unreachable(self):
        with patch.object(
            Server, "instance", new_callable=lambda: property(lambda self: _AlwaysFail())
        ):
            with self.assertRaises(NoMediaServerAvailable):
                Server.get_server()

    def test_clear_room_pin_releases_lock(self):
        room_uuid = uuid.uuid4()
        with patch.object(Server, "instance", new_callable=_all_ok_property):
            pinned = Server.get_or_pin_for_room(room_uuid)
            Server.clear_room_pin(room_uuid)
            repick = Server.get_or_pin_for_room(room_uuid)
        self.assertNotEqual(pinned.pk, repick.pk)

    def test_get_pinned_for_room_returns_none_when_unpinned(self):
        self.assertIsNone(Server.get_pinned_for_room(uuid.uuid4()))

    def test_get_pinned_for_room_returns_pinned_without_repinning(self):
        room_uuid = uuid.uuid4()
        with patch.object(Server, "instance", new_callable=_all_ok_property):
            pinned = Server.get_or_pin_for_room(room_uuid)
        # No connection test / round-robin advance: it just reads the pin.
        found = Server.get_pinned_for_room(room_uuid)
        self.assertIsNotNone(found)
        self.assertEqual(found.pk, pinned.pk)
