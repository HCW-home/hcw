from django.db import migrations, models

import users.validators


class Migration(migrations.Migration):

    dependencies = [
        ('users', '0050_normalize_phone_numbers_e164'),
    ]

    operations = [
        migrations.AlterField(
            model_name='user',
            name='mobile_phone_number',
            field=models.CharField(blank=True, max_length=32, null=True, unique=True, validators=[users.validators.validate_phone_number]),
        ),
    ]
