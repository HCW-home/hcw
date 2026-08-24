import re
from collections import defaultdict

import phonenumbers
from django.db import migrations

# Frozen copy of users.phone at the time of this migration, following the same
# convention as 0045_normalize_phone_numbers: a migration must keep behaving
# the same way even if the application helper later changes.
MAX_PHONE_LENGTH = 32
_SEPARATORS = re.compile(r"[\s\-.()]")


def _default_region():
    try:
        from constance import config as constance_config

        return getattr(constance_config, "default_phone_region", "") or None
    except Exception:
        return None


def normalize(value, region):
    if not value:
        return None
    cleaned = _SEPARATORS.sub("", value.strip())
    if not cleaned:
        return None
    try:
        parsed = phonenumbers.parse(cleaned, region)
    except phonenumbers.NumberParseException:
        return cleaned
    if not phonenumbers.is_valid_number(parsed):
        return cleaned
    return phonenumbers.format_number(parsed, phonenumbers.PhoneNumberFormat.E164)


def _plan(User, region):
    """Group every stored number by the canonical form it will be rewritten to."""
    by_canonical = defaultdict(list)
    rows = (
        User.objects.exclude(mobile_phone_number__isnull=True)
        .exclude(mobile_phone_number="")
        .values_list("pk", "mobile_phone_number")
    )
    for pk, raw in rows:
        by_canonical[normalize(raw, region)].append((pk, raw))
    return by_canonical


def check_no_e164_collisions(apps, schema_editor):
    """Fail early, with the full list, when the numbers cannot be canonicalised.

    Until now '0612345678' and '+33612345678' were two legal rows for the same
    real number. Rewriting both to E.164 makes them collide, and PostgreSQL
    would only report the first conflict — on a multi-tenant deployment that
    means re-running the upgrade once per duplicate to discover them all. List
    them upfront instead so they can be merged or deleted in one pass.
    """
    User = apps.get_model("users", "User")
    region = _default_region()

    collisions = []
    too_long = []
    for canonical, entries in _plan(User, region).items():
        # Values that normalise to NULL (e.g. '----') stay non-unique in
        # PostgreSQL, so several of them together are not a conflict.
        if canonical is None:
            continue
        if len(canonical) > MAX_PHONE_LENGTH:
            too_long.extend(entries)
        if len(entries) > 1:
            listed = ", ".join(f"#{pk} ({raw!r})" for pk, raw in sorted(entries))
            collisions.append(f"  {canonical}: {listed}")

    if not collisions and not too_long:
        return

    details = []
    if collisions:
        details.append(
            "These numbers are used by several accounts once normalised:\n"
            + "\n".join(sorted(collisions))
        )
    if too_long:
        listed = ", ".join(f"#{pk} ({raw!r})" for pk, raw in sorted(too_long))
        details.append(f"These numbers exceed {MAX_PHONE_LENGTH} characters: {listed}")

    schema = getattr(schema_editor.connection, "schema_name", "?")
    raise RuntimeError(
        f"Cannot canonicalise User.mobile_phone_number in schema '{schema}'. "
        "Fix the rows below, then re-run the migration.\n" + "\n".join(details)
    )


def normalize_to_e164(apps, schema_editor):
    User = apps.get_model("users", "User")
    region = _default_region()

    for canonical, entries in _plan(User, region).items():
        for pk, raw in entries:
            if canonical != raw:
                User.objects.filter(pk=pk).update(mobile_phone_number=canonical)


class Migration(migrations.Migration):

    dependencies = [
        ('users', '0049_organisation_footer_patient_ar_and_more'),
    ]

    operations = [
        migrations.RunPython(check_no_e164_collisions, migrations.RunPython.noop),
        migrations.RunPython(normalize_to_e164, migrations.RunPython.noop),
    ]
