from django import template
from django.conf import settings
from django.utils.safestring import mark_safe
from django.utils.translation import gettext

register = template.Library()


@register.filter
def fieldset_description(title: str) -> str:
    """Return the HTML description configured for a Constance fieldset title.

    Titles and descriptions are stored untranslated in the settings (they are
    dict keys), so the active-language lookup happens here.

    Empty string when no description is configured — the template should
    omit the description block in that case.
    """
    descriptions = getattr(settings, "CONSTANCE_FIELDSET_DESCRIPTIONS", {}) or {}
    description = descriptions.get(title, "")
    return mark_safe(gettext(description) if description else "")
