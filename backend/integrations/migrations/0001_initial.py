"""Initial migration: OdooSyncState idempotency ledger.

Hand-authored because the dev environment here has no Postgres to run
``makemigrations`` against. Mirrors what Django would generate from
integrations.models.OdooSyncState.
"""

from django.db import migrations, models


class Migration(migrations.Migration):

    initial = True
    dependencies = []

    operations = [
        migrations.CreateModel(
            name="OdooSyncState",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("content_type", models.CharField(max_length=100)),
                ("object_id", models.PositiveBigIntegerField()),
                ("odoo_model", models.CharField(max_length=100)),
                ("odoo_id", models.IntegerField(null=True)),
                ("event_hash", models.CharField(max_length=64)),
                ("last_synced_at", models.DateTimeField(auto_now=True)),
            ],
            options={
                "constraints": [
                    models.UniqueConstraint(
                        fields=["content_type", "object_id", "odoo_model"],
                        name="uniq_sync_target",
                    )
                ]
            },
        )
    ]
