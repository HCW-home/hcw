from modeltranslation.translator import register, TranslationOptions

from .models import Template


@register(Template)
class TemplateTranslation(TranslationOptions):
    fields = ['template_text', 'template_subject']