from django.db import migrations, models


def date_existing_codes(apps, schema_editor):
    """Date the codes already out with the timestamp that dated them so far.

    Codes in flight at deploy time keep the age they had, so they stay usable
    until their usual expiry. Copying it onto every other account as well
    closes any magic-link grace period open at that moment, which only means a
    code is asked for a few minutes early.
    """
    User = apps.get_model("users", "User")
    User.objects.filter(verification_code_created_at__isnull=False).update(
        verification_code_issued_at=models.F("verification_code_created_at")
    )
    User.objects.filter(
        verification_code__isnull=False,
        verification_code_created_at__isnull=False,
    ).update(verification_code_sent_at=models.F("verification_code_created_at"))


class Migration(migrations.Migration):

    dependencies = [
        ("users", "0055_merge_20261020_0717"),
    ]

    operations = [
        migrations.AddField(
            model_name="user",
            name="verification_code_issued_at",
            field=models.DateTimeField(
                blank=True,
                help_text="When the pending verification code was generated",
                null=True,
            ),
        ),
        migrations.AddField(
            model_name="user",
            name="verification_code_sent_at",
            field=models.DateTimeField(
                blank=True,
                help_text="When the pending verification code was last sent",
                null=True,
            ),
        ),
        migrations.RunPython(date_existing_codes, migrations.RunPython.noop),
    ]
