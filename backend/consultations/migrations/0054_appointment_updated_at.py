from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("consultations", "0053_alter_customfield_target_model"),
    ]

    operations = [
        migrations.AddField(
            model_name="appointment",
            name="updated_at",
            field=models.DateTimeField(auto_now=True, null=True, verbose_name="updated at"),
        ),
        migrations.AddIndex(
            model_name="appointment",
            index=models.Index(
                fields=["updated_at", "scheduled_at"],
                name="appt_updat_sched_idx",
            ),
        ),
    ]
