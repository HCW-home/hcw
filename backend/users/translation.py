from modeltranslation.translator import register, TranslationOptions

from .models import Speciality


@register(Speciality)
class SpecialityTranslation(TranslationOptions):
    fields = ["name"]
