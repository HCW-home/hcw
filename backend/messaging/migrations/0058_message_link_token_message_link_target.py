from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('messaging', '0057_template_template_content_ar_and_more'),
    ]

    operations = [
        migrations.AddField(
            model_name='message',
            name='link_token',
            field=models.CharField(blank=True, max_length=32, null=True, unique=True, verbose_name='link token'),
        ),
        migrations.AddField(
            model_name='message',
            name='link_target',
            field=models.TextField(blank=True, null=True, verbose_name='link target'),
        ),
        migrations.AddField(
            model_name='templatevalidation',
            name='variable_expressions',
            field=models.JSONField(blank=True, default=list, help_text="Ordered template expressions behind the provider's positional placeholders ({{1}}, {{2}}...), as submitted for approval. Replayed at send time so the numbering can never drift."),
        ),
    ]
