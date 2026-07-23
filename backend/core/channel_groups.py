"""Tenant-scoped Channels group names.

Every tenant shares the same Redis channel layer, so a bare group name like
``user_42`` is the *same* group for user 42 of tenant A and user 42 of tenant B:
a ``group_send`` issued from one tenant is delivered to the WebSockets of the
other. Group names must therefore always be namespaced with the tenant schema.

Senders running in a normal tenant context (views, signals, tenant-aware celery
tasks) can rely on the implicit ``connection.schema_name``. Consumers must pass
``schema_name`` explicitly: they run in the async event loop where the database
connection is shared between all open WebSockets and cannot be trusted.
"""

from django.db import connection


def current_schema():
    """Schema of the tenant bound to the current database connection."""
    return getattr(connection, "schema_name", "public")


def tenant_group(name, schema_name=None):
    """Namespace a raw group name with a tenant schema."""
    return f"{schema_name or current_schema()}.{name}"


def user_group(user_id, schema_name=None):
    """Group receiving the personal events of a single user."""
    return tenant_group(f"user_{user_id}", schema_name)


def broadcast_group(schema_name=None):
    """Group receiving the events sent to every connected user of a tenant."""
    return tenant_group("broadcast", schema_name)


def consultation_group(consultation_pk, schema_name=None):
    """Group receiving the events of a single consultation."""
    return tenant_group(f"consultation_{consultation_pk}", schema_name)
