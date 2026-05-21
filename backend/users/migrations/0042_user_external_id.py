from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("users", "0041_user_encryption_fields"),
    ]

    operations = [
        migrations.AddField(
            model_name="user",
            name="external_id",
            field=models.CharField(
                blank=True,
                db_index=True,
                help_text=(
                    "Identifier from an external system (e.g. OpenMRS). "
                    "Hidden from native API; exposed only via FHIR identifier array."
                ),
                max_length=255,
                null=True,
                verbose_name="external id",
            ),
        ),
        migrations.AddConstraint(
            model_name="user",
            constraint=models.UniqueConstraint(
                condition=models.Q(("external_id__isnull", False)),
                fields=("external_id",),
                name="user_external_id_unique",
            ),
        ),
    ]
