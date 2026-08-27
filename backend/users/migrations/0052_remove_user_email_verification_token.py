from django.db import migrations


class Migration(migrations.Migration):

    dependencies = [
        ("users", "0051_alter_user_mobile_phone_number"),
    ]

    operations = [
        # Email verification now reuses the short-code fields shared with the
        # passwordless login flow, so the link token has no writer left.
        migrations.RemoveField(
            model_name="user",
            name="email_verification_token",
        ),
    ]
