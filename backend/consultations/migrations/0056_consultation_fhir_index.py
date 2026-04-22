from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("consultations", "0055_alter_reason_assignment_method_alter_reason_name_and_more"),
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
