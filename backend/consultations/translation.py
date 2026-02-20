from modeltranslation.translator import register, TranslationOptions

from .models import CustomField, Queue, Reason


@register(Queue)
class QueueTranslation(TranslationOptions):
    fields = ["name"]

@register(Reason)
class ReasonTranslation(TranslationOptions):
    fields = ["name"]

@register(CustomField)
class CustomFieldTranslation(TranslationOptions):
    fields = ["name"]
