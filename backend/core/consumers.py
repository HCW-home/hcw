"""Shared building blocks for tenant-aware WebSocket consumers."""

from contextlib import nullcontext

from django_tenants.utils import schema_context


def tenant_scope(schema_name):
    """Bind the connection to a tenant, or keep the ambient one when unknown."""
    return schema_context(schema_name) if schema_name else nullcontext()


class TenantConsumerMixin:
    """Tenant awareness for WebSocket consumers.

    ``TenantMiddleware`` publishes the tenant in the scope but does not bind it
    to the database connection: thread-sensitive sync calls of the whole ASGI
    process share a single worker thread, hence a single connection, so binding
    it would rebind the schema of every other WebSocket open in the process.

    Consumers must therefore wrap their own database and cache access in
    ``tenant_scope()``, and namespace every channel group with ``schema_name``
    (see ``core.channel_groups``) since the channel layer is shared by all
    tenants.
    """

    @property
    def schema_name(self):
        """Tenant schema of this connection, resolved by TenantMiddleware."""
        tenant = self.scope.get("tenant")
        return tenant.schema_name if tenant else None

    def tenant_scope(self):
        """Bind the connection to this tenant for the duration of the block."""
        return tenant_scope(self.schema_name)
