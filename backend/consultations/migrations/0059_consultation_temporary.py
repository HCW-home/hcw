from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('consultations', '0058_encryption'),
    ]

    operations = [
        migrations.AddField(
            model_name='consultation',
            name='temporary',
            field=models.BooleanField(
                default=False,
                help_text=(
                    'Auto-created for an online Appointment without explicit '
                    'consultation; hidden from practitioner and patient lists, '
                    'auto-closed once the appointment join window has elapsed.'
                ),
                verbose_name='temporary',
            ),
        ),
    ]
