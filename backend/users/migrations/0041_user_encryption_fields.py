from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("users", "0040_user_date_of_birth_user_gender_user_updated_at"),
    ]

    operations = [
        migrations.AddField(
            model_name="user",
            name="public_key",
            field=models.TextField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name="user",
            name="public_key_fingerprint",
            field=models.CharField(blank=True, max_length=64, null=True),
        ),
        migrations.AddField(
            model_name="user",
            name="encrypted_private_key",
            field=models.TextField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name="user",
            name="encryption_passphrase_pending",
            field=models.BooleanField(default=False),
        ),
        migrations.AddField(
            model_name="user",
            name="encryption_key_lost",
            field=models.BooleanField(default=False),
        ),
    ]
