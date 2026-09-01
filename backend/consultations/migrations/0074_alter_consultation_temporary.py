from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('consultations', '0073_customfield_name_ar_queue_name_ar_reason_name_ar'),
    ]

    operations = [
        migrations.AlterField(
            model_name='consultation',
            name='temporary',
            field=models.BooleanField(default=False, help_text='Auto-created for an online Appointment without explicit consultation; hidden from practitioner and patient lists, auto-closed once the delay configured in auto_close_temporary_consultations_minutes has elapsed on top of the appointment join window.', verbose_name='temporary'),
        ),
    ]
