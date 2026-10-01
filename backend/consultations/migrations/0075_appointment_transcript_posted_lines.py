from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('consultations', '0074_alter_consultation_temporary'),
    ]

    operations = [
        migrations.AddField(
            model_name='appointment',
            name='transcript_posted_lines',
            field=models.PositiveIntegerField(default=0, help_text='Number of transcript lines already posted in the consultation chat', verbose_name='transcript lines posted'),
        ),
    ]
