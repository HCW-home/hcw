import logging

from asgiref.sync import sync_to_async
from core.consumers import tenant_scope
from django.core.cache import cache
from django.db import connection

logger = logging.getLogger(__name__)

# Cache timeout in seconds (40 seconds, refreshed on each heartbeat ping)
ONLINE_CACHE_TIMEOUT = 40
ONLINE_CACHE_PREFIX = "user_online:"


class UserOnlineStatusService:
    """
    Service for tracking user online status using Django cache.
    Cache key exists = user is online. Expires naturally if no heartbeat.
    """

    def _get_cache_key(self, user_id, schema_name=None):
        schema = schema_name or connection.tenant.schema_name
        return f"{schema}:{ONLINE_CACHE_PREFIX}{user_id}"

    def set_user_online(self, user_id, schema_name=None):
        cache.set(self._get_cache_key(user_id, schema_name), True, ONLINE_CACHE_TIMEOUT)

    def set_user_offline(self, user_id, schema_name=None):
        cache.delete(self._get_cache_key(user_id, schema_name))

    def is_user_online(self, user_id, schema_name=None):
        return cache.get(self._get_cache_key(user_id, schema_name), False)

    def refresh_online(self, user_id, schema_name=None):
        cache.set(self._get_cache_key(user_id, schema_name), True, ONLINE_CACHE_TIMEOUT)


class AsyncUserOnlineStatusService:
    """Async wrapper for WebSocket consumers.

    Consumers must pass ``schema_name``: the sync calls below all run in the
    same shared worker thread, so the tenant bound to ``connection`` there
    belongs to whichever WebSocket touched it last.
    """

    def __init__(self):
        self.sync_service = UserOnlineStatusService()

    @sync_to_async
    def set_user_online(self, user_id, schema_name=None):
        with tenant_scope(schema_name):
            return self.sync_service.set_user_online(user_id, schema_name)

    @sync_to_async
    def set_user_offline(self, user_id, schema_name=None):
        with tenant_scope(schema_name):
            return self.sync_service.set_user_offline(user_id, schema_name)

    @sync_to_async
    def is_user_online(self, user_id, schema_name=None):
        with tenant_scope(schema_name):
            return self.sync_service.is_user_online(user_id, schema_name)

    @sync_to_async
    def refresh_online(self, user_id, schema_name=None):
        with tenant_scope(schema_name):
            return self.sync_service.refresh_online(user_id, schema_name)


# Global instances
user_online_service = UserOnlineStatusService()
async_user_online_service = AsyncUserOnlineStatusService()


def visible_practitioners_qs(user):
    """Queryset of practitioners the given user is allowed to see.

    Governed by the ``users_visibility`` Constance setting:
    - ``all``          -> every active practitioner
    - ``alone``        -> only the user themselves
    - ``organization`` -> practitioners of the same organisation (+ self)

    Centralizes the scope so appointments and reminders share the same rule
    as the user-search endpoint.
    """
    from constance import config
    from django.db.models import Q

    from .models import User

    qs = User.objects.filter(is_practitioner=True, is_active=True)
    visibility = config.users_visibility

    if not visibility or visibility == "all":
        return qs

    if visibility == "alone":
        return qs.filter(id=user.id)

    if visibility == "organization":
        user_orgs = list(user.organisations.values_list("id", flat=True))
        org_filters = Q(id=user.id)
        if user.main_organisation_id:
            org_filters |= Q(main_organisation=user.main_organisation_id)
        if user_orgs:
            org_filters |= Q(organisations__id__in=user_orgs)
        return qs.filter(org_filters).distinct()

    return qs


def visible_practitioner_ids(user):
    """List of practitioner ids visible to the user (see visible_practitioners_qs)."""
    return list(visible_practitioners_qs(user).values_list("id", flat=True))
