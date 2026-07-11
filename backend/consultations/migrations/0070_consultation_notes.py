from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("consultations", "0069_reminder_recurrence_end_at_and_more"),
    ]

    operations = [
        migrations.AddField(
            model_name="consultation",
            name="notes",
            field=models.TextField(
                blank=True,
                help_text=(
                    "Internal clinical notes, only visible to practitioners. "
                    "Never shown to the beneficiary. Mapped to FHIR Encounter.note."
                ),
                null=True,
                verbose_name="notes",
            ),
        ),
    ]
