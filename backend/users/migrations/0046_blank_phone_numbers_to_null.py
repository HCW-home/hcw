from django.db import migrations


def blank_to_null(apps, schema_editor):
    """Convert empty-string phone numbers to NULL.

    mobile_phone_number is unique. Postgres allows multiple NULLs but only one
    empty string, so any user saved with an empty number after the first hits an
    IntegrityError. Storing NULL instead keeps "no phone number" non-unique.
    """
    User = apps.get_model("users", "User")
    User.objects.filter(mobile_phone_number="").update(mobile_phone_number=None)


class Migration(migrations.Migration):

    dependencies = [
        ('users', '0045_normalize_phone_numbers'),
    ]

    operations = [
        migrations.RunPython(blank_to_null, migrations.RunPython.noop),
    ]
