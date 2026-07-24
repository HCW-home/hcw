from django.db import migrations, models
import core.storage


class Migration(migrations.Migration):

    dependencies = [
        ('users', '0046_blank_phone_numbers_to_null'),
    ]

    operations = [
        migrations.AddField(
            model_name='speciality',
            name='icon',
            field=models.ImageField(blank=True, help_text='Custom icon for this speciality.', null=True, upload_to=core.storage.TenantUploadTo('specialities')),
        ),
    ]
