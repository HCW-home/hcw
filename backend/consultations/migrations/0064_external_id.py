from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("consultations", "0063_alter_queuemembership_user"),
    ]

    operations = [
        migrations.AddField(
            model_name="appointment",
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
        migrations.AddField(
            model_name="consultation",
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
        migrations.AddField(
            model_name="prescription",
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
            model_name="appointment",
            constraint=models.UniqueConstraint(
                condition=models.Q(("external_id__isnull", False)),
                fields=("external_id",),
                name="appointment_external_id_unique",
            ),
        ),
        migrations.AddConstraint(
            model_name="consultation",
            constraint=models.UniqueConstraint(
                condition=models.Q(("external_id__isnull", False)),
                fields=("external_id",),
                name="consultation_external_id_unique",
            ),
        ),
        migrations.AddConstraint(
            model_name="prescription",
            constraint=models.UniqueConstraint(
                condition=models.Q(("external_id__isnull", False)),
                fields=("external_id",),
                name="prescription_external_id_unique",
            ),
        ),
    ]
