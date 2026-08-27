from django.db import migrations

LANGUAGES = ("en", "ar", "de", "es", "fr", "it", "uk")

# Appended to admin-customised templates that still describe the link-based
# flow, so the recipient actually gets the code they now have to type back.
CODE_SENTENCE = {
    "template_content": (
        "\n\nTo finish creating your account, please use this verification "
        "code: {{ obj.verification_code }}"
    ),
    "template_content_html": (
        "<p>To finish creating your account, please use this verification "
        "code: <strong>{{ obj.verification_code }}</strong></p>"
    ),
}


def add_code_to_overrides(apps, schema_editor):
    """Repair per-instance overrides of the ``email_verification`` template.

    Defaults live in messaging/template.py, but an admin may have overridden
    this template in the database. Those rows still hold the old link wording,
    which no longer carries anything actionable, and an ``action_label`` that
    would render an empty button (``Message.access_link`` is now None because
    the template has no action).
    """
    Template = apps.get_model("messaging", "Template")

    for template in Template.objects.filter(event_type="email_verification"):
        fields = ["action_label"]
        template.action_label = ""

        for base, sentence in CODE_SENTENCE.items():
            for field in [base] + [f"{base}_{lang}" for lang in LANGUAGES]:
                if not hasattr(template, field):
                    continue
                content = getattr(template, field)
                if not content or "verification_code" in content:
                    continue
                setattr(template, field, content + sentence)
                fields.append(field)

        template.save(update_fields=fields)


class Migration(migrations.Migration):

    dependencies = [
        ("messaging", "0058_message_link_token_message_link_target"),
    ]

    operations = [
        migrations.RunPython(add_code_to_overrides, migrations.RunPython.noop),
    ]
