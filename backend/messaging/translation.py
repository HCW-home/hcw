from modeltranslation.translator import TranslationOptions, register

from .models import Template


@register(Template)
class TemplateTranslation(TranslationOptions):
    fields = ["template_content", "template_subject", "template_content_html"]
