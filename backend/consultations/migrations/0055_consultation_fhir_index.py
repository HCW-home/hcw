from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("consultations", "0054_appointment_updated_at"),
    ]

    operations = [
        migrations.AddIndex(
            model_name="consultation",
            index=models.Index(
                fields=["beneficiary", "created_at"],
                name="cons_benef_created_idx",
            ),
        ),
    ]
