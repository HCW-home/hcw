from django.db import migrations, models


def set_is_practitioner(apps, schema_editor):
    """Set is_practitioner=True for all users that belong to at least one group."""
    User = apps.get_model("users", "User")
    User.objects.filter(groups__isnull=False).distinct().update(is_practitioner=True)


class Migration(migrations.Migration):

    dependencies = [
        ("users", "0022_alter_user_one_time_auth_token"),
    ]

    operations = [
        migrations.AddField(
            model_name="user",
            name="is_practitioner",
            field=models.BooleanField(
                default=False,
                help_text="Whether this user is a practitioner",
            ),
        ),
        migrations.RunPython(set_is_practitioner, migrations.RunPython.noop),
    ]
