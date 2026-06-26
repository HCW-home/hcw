from django import template
from django.conf import settings
from django.utils.safestring import mark_safe

register = template.Library()


@register.filter
def fieldset_description(title: str) -> str:
    """Return the HTML description configured for a Constance fieldset title.

    Empty string when no description is configured — the template should
    omit the description block in that case.
    """
    descriptions = getattr(settings, "CONSTANCE_FIELDSET_DESCRIPTIONS", {}) or {}
    return mark_safe(descriptions.get(title, ""))
