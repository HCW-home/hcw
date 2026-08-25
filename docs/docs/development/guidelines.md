# Development Guidelines

These rules apply to every contribution to HCW@Home. They exist because the
platform is **multi-tenant** and deployed on institution-managed instances that
are upgraded without notice: a new release must never change what an existing
tenant sees until an administrator explicitly asks for it.

## A new feature is never enabled by default

Any feature added to the platform ships **off**. Upgrading to a release that
contains it must be a no-op for every existing tenant.

- A boolean flag defaults to `False`.
- A non-boolean setting defaults to the value that reproduces the previous
  behaviour (`0` to disable a limit, `""` for an optional URL, and so on).
- The default is what a brand-new tenant gets too — a fresh instance and an
  upgraded one behave identically.

```python
# backend/core/settings.py
CONSTANCE_CONFIG = {
    "enable_video_recording": (
        False,
        gettext_noop("Enable video recording during appointments"),
    ),
}
```

The only exception is a genuine bug fix: correcting a behaviour that was
already wrong does not need a flag.

## A feature is activated per tenant

Activation belongs to the tenant administrator, never to the deployment. The
`constance` app is part of `TENANT_APPS`, so each tenant schema holds its own
configuration table and one tenant turning a feature on changes nothing for
the others.

Concretely:

- **Never** gate a feature on an environment variable or on a `settings.py`
  constant. Environment variables are for infrastructure only — database
  credentials, Redis host, S3 bucket, secrets. They are shared by every tenant
  of the instance and cannot be changed from the admin UI.
- **Always** gate it on a Constance key, editable from
  *Settings > Configuration* in the admin.

### Declaring a flag

Three places in `backend/core/settings.py` must be updated together:

| Setting | Role |
|---------|------|
| `CONSTANCE_CONFIG` | The key, its default, its translatable help text, and optionally a custom field |
| `CONSTANCE_CONFIG_FIELDSETS` | The admin tab the key belongs to — a key missing here is invisible in the UI |
| `CONSTANCE_FIELDSET_DESCRIPTIONS` | The short explanation shown at the top of the tab (only when adding a new tab) |

Naming follows the existing keys:

- `enable_*` — opt-in feature, defaults to `False` (`enable_video_recording`,
  `enable_deeplink`, `enable_calendar_colorization`)
- `force_*` — makes an existing behaviour mandatory (`force_temporary_patients`,
  `force_mobile_app`)
- `disable_*` — removes a behaviour that is on by default
  (`disable_password_login`)

Help texts are wrapped in `gettext_noop()` so they can be translated.

### Reading a flag

```python
from constance import config

if not config.enable_video_recording:
    return Response(status=status.HTTP_403_FORBIDDEN)
```

`config` resolves the value at attribute access, against the schema of the
current request. Never snapshot a flag into a module-level constant, a default
argument or a class attribute: it would freeze the value of whichever tenant
happened to be active at import time.

The same applies to Celery tasks — read the flag inside the task body, after
the tenant schema has been activated.

## Enforce the flag on the backend, not only in the UI

Hiding a button is not gating a feature. Every flag is enforced server-side, in
the view, serializer or task that performs the action; the frontend check only
avoids showing something that would be refused.

Frontends read the flags from the public `/api/config/` endpoint
(`users.views.AppConfigView`), which already returns the tenant's configuration
for the requested domain. Add the new key there rather than creating a
dedicated endpoint.

## Turning a feature on must not rewrite existing data

A flag is switched on in production, on a tenant that already has years of
data. Enabling it must not retroactively modify past records.

`enable_appointment_outcome_detection` is the reference pattern: it comes with
`appointment_outcome_lookback_days`, so the periodic task only qualifies
appointments from the last few days and leaves older ones untouched.

Where a retroactive pass is genuinely wanted, it belongs to an explicit admin
action or a management command — not to the act of ticking a checkbox.

## Multi-tenancy

- `SHARED_APPS` live in the `public` schema (tenants, sessions, static
  infrastructure). `TENANT_APPS` are duplicated per tenant. Adding an app to
  the wrong tuple silently gives every tenant the same rows, or hides shared
  data from all of them.
- `python manage.py migrate` is the django-tenants variant: it migrates the
  public schema and every tenant schema. A migration must therefore be
  idempotent and cheap enough to run once per tenant.
- Data migrations run inside each schema. Never assume the `public` schema is
  active, and never hardcode a schema name.
- Caches are already namespaced per tenant (`django_tenants.cache.make_key`).
  Any other shared storage — a file path, an external bucket prefix, a Celery
  queue name — must be namespaced explicitly.

## Translations

- Every user-facing string goes through `gettext` / `gettext_lazy`, or
  `gettext_noop` for strings declared at import time such as Constance help
  texts.
- Code comments and commit messages are in English.
- After adding strings:

```bash
./manage.py makemessages --locale=fr --ignore='venv/*'
./manage.py compilemessages --ignore='venv/*'
```

Frontend translations are managed on
[translate.iabsis.com](https://translate.iabsis.com/) — do not edit the
generated catalogues by hand.

## Tests

Backend tests run on every push and pull request
(`.github/workflows/tests.yml`). They need PostgreSQL: the schema-per-tenant
model rules out SQLite.

```bash
cd backend
python manage.py test
```

A feature flag deserves two tests at minimum: the feature is inert when the
flag is off, and it works when the flag is on. Tests are grouped per app, in
`tests.py` or in a `tests_<topic>.py` module next to it.

## Document the feature

A feature that cannot be found in the admin documentation does not exist for
the administrator who has to enable it. Any new Constance key is added to
[Advanced Options](../admin/advanced-options.md), in the table matching its
fieldset, with its code, default and description. A feature large enough to
need explanation gets its own page under *Administration* and an entry in
`docs/mkdocs.yml`.
