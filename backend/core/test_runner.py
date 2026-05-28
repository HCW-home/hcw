"""Custom test runner for the django_tenants setup.

Why this exists
---------------
`django_tenants` 3.10 does not ship its own test runner. `TenantTestCase`
creates a tenant + schema in `setUpClass` and deletes it in `tearDownClass`,
but anything that crashes that teardown (failing migration, hook abort,
Ctrl-C, ...) leaves the tenant row and schema behind, and every subsequent
class then dies with:

    duplicate key value violates unique constraint "tenants_tenant_schema_name_key"
    DETAIL:  Key (schema_name)=(test) already exists.

We solve this in two places:

1. The runner wipes leftover `test` / `fast_test` tenants once at the start
   of the suite (handles interrupted previous runs, especially with
   `--keepdb`).
2. We monkey-patch `TenantTestCase.setUpClass` so it always wipes the same
   stale rows right before creating its own tenant (handles a teardown that
   crashed earlier in the same run).
"""
from django.db import connection
from django.test.runner import DiscoverRunner


def _drop_stale_test_tenants():
    from django_tenants.utils import get_tenant_domain_model, get_tenant_model
    tenant_model = get_tenant_model()
    domain_model = get_tenant_domain_model()
    connection.set_schema_to_public()
    for schema in ("test", "fast_test"):
        for tenant in tenant_model.objects.filter(schema_name=schema):
            domain_model.objects.filter(tenant=tenant).delete()
            tenant.delete(force_drop=True)


def _install_tenant_test_case_patches():
    """Patch `TenantTestCase` for two issues we hit on django_tenants 3.10:

    1. `setUpClass` must wipe any leftover test tenant before creating its
       own (handles a teardown that crashed earlier in the same run).
    2. `_pre_setup` must re-pin the connection to the test tenant: Django's
       per-test transaction wrapping resets the connection's search_path
       between tests, so the second test in a class ends up looking at the
       public schema (where TENANT_APPS tables do NOT live) and dies with
       "relation users_user does not exist".

    Both patches are idempotent.
    """
    from django.db import connection
    from django_tenants.test import cases as tenant_cases

    original_setup_class = tenant_cases.TenantTestCase.setUpClass
    if not getattr(original_setup_class, "_hcw_patched", False):
        @classmethod
        def patched_setup_class(cls):
            _drop_stale_test_tenants()
            original_setup_class.__func__(cls)
            # DRF APIClient uses "testserver" as HTTP_HOST. Without a
            # matching domain, TenantMainMiddleware raises Http404 and every
            # test that doesn't override the host turns into a 404. Bind the
            # test tenant to "testserver" too.
            from django_tenants.utils import get_tenant_domain_model
            from django.conf import settings
            domain_model = get_tenant_domain_model()
            if not domain_model.objects.filter(
                tenant=cls.tenant, domain="testserver"
            ).exists():
                domain_model.objects.create(tenant=cls.tenant, domain="testserver")
            if "testserver" not in settings.ALLOWED_HOSTS:
                settings.ALLOWED_HOSTS = list(settings.ALLOWED_HOSTS) + ["testserver"]

        patched_setup_class.__func__._hcw_patched = True
        tenant_cases.TenantTestCase.setUpClass = patched_setup_class

    # `_pre_setup` is a `@classmethod` in modern Django (and is invoked once
    # per test). Re-pin the search_path here: Django's per-test transaction
    # wrapping resets it between tests, so the second test in a class would
    # otherwise hit the public schema.
    original_pre_setup = tenant_cases.TenantTestCase._pre_setup
    if not getattr(original_pre_setup, "_hcw_patched", False):
        @classmethod
        def patched_pre_setup(cls):
            if getattr(cls, "tenant", None) is not None:
                connection.set_tenant(cls.tenant)
            original_pre_setup.__func__(cls)

        patched_pre_setup.__func__._hcw_patched = True
        tenant_cases.TenantTestCase._pre_setup = patched_pre_setup


class TenantAwareTestRunner(DiscoverRunner):
    def setup_test_environment(self, **kwargs):
        super().setup_test_environment(**kwargs)
        _install_tenant_test_case_patches()

    def setup_databases(self, **kwargs):
        result = super().setup_databases(**kwargs)
        _drop_stale_test_tenants()
        return result
