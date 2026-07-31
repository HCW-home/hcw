from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("consultations", "0070_consultation_notes"),
    ]

    operations = [
        migrations.AlterField(
            model_name="appointment",
            name="scheduled_at",
            field=models.DateTimeField(
                blank=True, null=True, verbose_name="scheduled at"
            ),
        ),
    ]
