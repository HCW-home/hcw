import django.db.models.deletion
from django.conf import settings
from django.db import migrations, models
from django.utils import timezone


class Migration(migrations.Migration):
    """
    Adds the encryption envelope/fingerprint columns to Queue, Consultation, Message,
    and converts the implicit Queue.users M2M into an explicit through model
    (QueueMembership) that can carry the per-member encrypted queue private key.

    The implicit M2M table `consultations_queue_users` is renamed in place to
    `consultations_queuemembership` and the new columns are added, so existing
    rows are preserved (no data loss).
    """

    dependencies = [
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
        ("consultations", "0057_remove_consultation_cons_benef_created_idx_and_more"),
    ]

    operations = [
        migrations.AddField(
            model_name="queue",
            name="public_key",
            field=models.TextField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name="queue",
            name="public_key_fingerprint",
            field=models.CharField(blank=True, max_length=64, null=True),
        ),
        migrations.AddField(
            model_name="queue",
            name="encrypted_queue_private_key_master",
            field=models.TextField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name="consultation",
            name="is_encrypted",
            field=models.BooleanField(default=False),
        ),
        migrations.AddField(
            model_name="consultation",
            name="encrypted_key_for_queue",
            field=models.TextField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name="consultation",
            name="queue_pubkey_fingerprint",
            field=models.CharField(blank=True, max_length=64, null=True),
        ),
        migrations.AddField(
            model_name="consultation",
            name="encrypted_key_for_owned_by",
            field=models.TextField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name="consultation",
            name="owned_by_pubkey_fingerprint",
            field=models.CharField(blank=True, max_length=64, null=True),
        ),
        migrations.AddField(
            model_name="consultation",
            name="encrypted_key_for_created_by",
            field=models.TextField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name="consultation",
            name="created_by_pubkey_fingerprint",
            field=models.CharField(blank=True, max_length=64, null=True),
        ),
        migrations.AddField(
            model_name="consultation",
            name="encrypted_key_for_beneficiary",
            field=models.TextField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name="consultation",
            name="beneficiary_pubkey_fingerprint",
            field=models.CharField(blank=True, max_length=64, null=True),
        ),
        migrations.AddField(
            model_name="consultation",
            name="encrypted_key_for_master",
            field=models.TextField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name="message",
            name="is_encrypted",
            field=models.BooleanField(default=False),
        ),
        migrations.AddField(
            model_name="message",
            name="encrypted_attachment_metadata",
            field=models.TextField(blank=True, null=True),
        ),
        migrations.SeparateDatabaseAndState(
            state_operations=[
                migrations.CreateModel(
                    name="QueueMembership",
                    fields=[
                        (
                            "id",
                            models.BigAutoField(
                                auto_created=True,
                                primary_key=True,
                                serialize=False,
                                verbose_name="ID",
                            ),
                        ),
                        (
                            "encrypted_queue_private_key",
                            models.TextField(blank=True, null=True),
                        ),
                        (
                            "created_at",
                            models.DateTimeField(default=timezone.now),
                        ),
                        (
                            "queue",
                            models.ForeignKey(
                                on_delete=django.db.models.deletion.CASCADE,
                                to="consultations.queue",
                            ),
                        ),
                        (
                            "user",
                            models.ForeignKey(
                                on_delete=django.db.models.deletion.CASCADE,
                                to=settings.AUTH_USER_MODEL,
                            ),
                        ),
                    ],
                    options={
                        "verbose_name": "queue membership",
                        "verbose_name_plural": "queue memberships",
                        "unique_together": {("queue", "user")},
                    },
                ),
                migrations.AlterField(
                    model_name="queue",
                    name="users",
                    field=models.ManyToManyField(
                        blank=True,
                        through="consultations.QueueMembership",
                        to=settings.AUTH_USER_MODEL,
                        verbose_name="users",
                    ),
                ),
            ],
            database_operations=[
                migrations.RunSQL(
                    sql=[
                        "ALTER TABLE consultations_queue_users RENAME TO consultations_queuemembership;",
                        "ALTER TABLE consultations_queuemembership ADD COLUMN encrypted_queue_private_key TEXT NULL;",
                        "ALTER TABLE consultations_queuemembership ADD COLUMN created_at TIMESTAMPTZ NOT NULL DEFAULT NOW();",
                    ],
                    reverse_sql=[
                        "ALTER TABLE consultations_queuemembership DROP COLUMN created_at;",
                        "ALTER TABLE consultations_queuemembership DROP COLUMN encrypted_queue_private_key;",
                        "ALTER TABLE consultations_queuemembership RENAME TO consultations_queue_users;",
                    ],
                ),
            ],
        ),
    ]
