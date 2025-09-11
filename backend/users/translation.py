from modeltranslation.translator import register, TranslationOptions

from .models import Speciality, Term


@register(Speciality)
class SpecialityTranslation(TranslationOptions):
    fields = ["name"]

@register(Term)
class TermTranslation(TranslationOptions):
    fields = ['name', 'content']