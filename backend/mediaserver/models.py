from importlib import import_module
from typing import Optional, Union
from uuid import UUID
import logging

from django.conf import settings
from django.core.cache import cache
from django.db import connection, models
from django.utils.translation import gettext_lazy as _

from . import manager
from .exceptions import NoMediaServerAvailable
from .manager import BaseMediaserver

logger = logging.getLogger(__name__)


def _current_schema() -> str:
    return getattr(getattr(connection, "tenant", None), "schema_name", None) or "public"


def _room_pin_cache_key(room_uuid) -> str:
    return f"mediaserver:room:{_current_schema()}:{room_uuid}"


def _round_robin_cache_key() -> str:
    return f"mediaserver:rr_index:{_current_schema()}"


# Create your models here.
class Server(models.Model):
    url = models.URLField(_("URL"))
    api_token = models.CharField(_("API token"), blank=True, null=True)
    api_secret = models.CharField(_("API secret"), blank=True, null=True)
    max_session_number = models.IntegerField(_("max session number"), default=10)
    type = models.CharField(choices=manager.MAIN_DISPLAY_NAMES)
    is_active = models.BooleanField(_("is active"), default=True)

    class Meta:
        verbose_name = _("server")
        verbose_name_plural = _("servers")

    def __str__(self):
        return self.url

    @property
    def module(self):
        return import_module(f"..manager.{self.type}", __name__)

    @property
    def instance(self) -> BaseMediaserver:
        return self.module.Main(self)

    @classmethod
    def _round_robin_pick(cls) -> Optional["Server"]:
        """Pick the next reachable active server using a tenant-scoped round-robin index.

        Returns None if no reachable server is found.
        """
        cache_key = _round_robin_cache_key()
        current_index = cache.get(cache_key, 0)

        active_servers = list(cls.objects.filter(is_active=True))
        active_server_count = len(active_servers)
        if active_server_count == 0:
            return None

        for i in range(active_server_count):
            next_index = (1 + i + current_index) % active_server_count
            candidate = active_servers[next_index]
            try:
                candidate.instance.test_connection()
            except Exception:
                logger.warning("Server unreachable or misconfigured: %s", candidate)
                continue
            cache.set(cache_key, next_index)
            return candidate

        return None

    @classmethod
    def get_server(cls) -> "Server":
        """Get an active and reachable server using round robin.

        Raises NoMediaServerAvailable if none is reachable.
        Intended for room-less flows (e.g. self test). For room-bound flows
        (consultations, appointments), use get_or_pin_for_room instead.
        """
        server = cls._round_robin_pick()
        if server is None:
            raise NoMediaServerAvailable("No reachable media server available")
        return server

    @classmethod
    def get_or_pin_for_room(cls, room_uuid: Union[str, UUID]) -> "Server":
        """Return the server pinned to a given room, or pick one and pin it.

        The pin is tenant-scoped and survives across requests via the cache.
        If the pinned server is no longer reachable, the pin is cleared and
        a new server is picked.

        Atomicity: uses cache.add() to claim the pin so concurrent first joins
        on the same room converge on the same server.

        Raises NoMediaServerAvailable if no reachable server can be found.
        """
        cache_key = _room_pin_cache_key(room_uuid)
        pinned_pk = cache.get(cache_key)

        if pinned_pk is not None:
            server = cls.objects.filter(pk=pinned_pk, is_active=True).first()
            if server is not None:
                try:
                    server.instance.test_connection()
                    return server
                except Exception:
                    logger.warning(
                        "Pinned server %s for room %s is unreachable, repicking",
                        server,
                        room_uuid,
                    )
            cache.delete(cache_key)

        candidate = cls._round_robin_pick()
        if candidate is None:
            raise NoMediaServerAvailable("No reachable media server available")

        ttl = getattr(settings, "ROOM_SERVER_PIN_TTL", 24 * 3600)
        if cache.add(cache_key, candidate.pk, timeout=ttl):
            return candidate

        winner_pk = cache.get(cache_key)
        if winner_pk is not None and winner_pk != candidate.pk:
            winner = cls.objects.filter(pk=winner_pk, is_active=True).first()
            if winner is not None:
                return winner

        # Cache was evicted between add() and get(), or the winner is no longer
        # active. Fall back to our own candidate and force-write the pin.
        cache.set(cache_key, candidate.pk, timeout=ttl)
        return candidate

    @classmethod
    def get_pinned_for_room(cls, room_uuid: Union[str, UUID]) -> Optional["Server"]:
        """Return the server currently pinned to a room, or None.

        Unlike get_or_pin_for_room, this never picks and pins a new server: if
        no server is pinned there is no live call on that room, so there is
        nothing to act on. Used to reach the media server hosting an ongoing
        call (e.g. to eject participants when a consultation is closed).
        """
        pinned_pk = cache.get(_room_pin_cache_key(room_uuid))
        if pinned_pk is None:
            return None
        return cls.objects.filter(pk=pinned_pk, is_active=True).first()

    @classmethod
    def clear_room_pin(cls, room_uuid: Union[str, UUID]) -> None:
        cache.delete(_room_pin_cache_key(room_uuid))


class Turn(models.Model):
    login = models.CharField(_("login"), null=True, blank=True)
    credential = models.CharField(_("credential"), null=True, blank=True)

    class Meta:
        verbose_name = _("TURN server")
        verbose_name_plural = _("TURN servers")


class TurnURL(models.Model):
    turn = models.ForeignKey(
        Turn, on_delete=models.CASCADE, verbose_name=_("TURN server")
    )
    url = models.CharField(_("URL"), help_text=_("TURN URL (e.g., turn://example.com)"))

    class Meta:
        verbose_name = _("TURN URL")
        verbose_name_plural = _("TURN URLs")
