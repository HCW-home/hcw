from modeltranslation.translator import register, TranslationOptions

from .models import Template


@register(Template)
class TemplateTranslation(TranslationOptions):
    fields = ['name', 'description', 'template_text', 'template_subject']