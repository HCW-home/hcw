"""Translation layer between our Jinja2 notification templates and the numbered
placeholder format required by WhatsApp / Twilio Content Templates.

A WhatsApp template is approved once by Meta with a frozen body where every
dynamic part is a positional placeholder ({{1}}, {{2}}, ...). At send time we
only supply the values. Both sides of that contract therefore have to agree on
the *order* of the placeholders, which is why the extraction lives here and is
shared by ``validate_template`` (submission) and ``send`` (delivery).
"""

import logging
import re
from typing import TYPE_CHECKING, Dict, List, Tuple

logger = logging.getLogger(__name__)

if TYPE_CHECKING:
    from .models import Message, Template

# Sentinel standing for the deep link carried by the call-to-action button. It
# is not a Jinja fragment: its value is the message link token, appended to the
# button's static base URL at send time.
LINK_TOKEN_EXPRESSION = "__link_token__"

# Any Jinja tag: an output, a statement or a comment. Non-greedy because a tag
# can never contain its own closing marker.
_TAG_RE = re.compile(r"\{\{.*?\}\}|\{%.*?%\}|\{#.*?#\}", re.DOTALL)

_STATEMENT_NAME_RE = re.compile(r"\{%-?\s*(\w+)")

# Statements that open a block and therefore have a matching end tag.
_BLOCK_TAGS = {
    "if",
    "for",
    "block",
    "with",
    "filter",
    "macro",
    "call",
    "raw",
    "autoescape",
    "trans",
}

# WhatsApp rejects parameter values containing newlines, tabs or long runs of
# spaces.
_WHITESPACE_RE = re.compile(r"\s+")

# Meta refuses a body that opens or closes on a variable, or that puts two
# variables back to back with nothing but spaces between them.
_LEADING_PLACEHOLDER_RE = re.compile(r"^\{\{\d+\}\}")
_TRAILING_PLACEHOLDER_RE = re.compile(r"\{\{\d+\}\}$")
_ADJACENT_PLACEHOLDERS_RE = re.compile(r"\{\{\d+\}\}\s*\{\{\d+\}\}")


def get_localized(template: "Template", field: str, language_code: str) -> str:
    """Return a translated template field, falling back to the default column.

    The fallback is a lazy translation for templates that have no database
    override, so it is resolved under the requested language rather than under
    whichever language happens to be active on the current thread. Without
    this, the very same template would hash differently from a Celery worker
    and from an admin request.
    """
    from django.utils import translation

    with translation.override(language_code):
        localized = getattr(template, f"{field}_{language_code}", None)
        return str(localized or getattr(template, field) or "")


def split_fragments(source: str) -> List[Tuple[bool, str]]:
    """Split a template into literal chunks and dynamic fragments.

    Returns ``(is_fragment, text)`` pairs. A whole control block
    (``{% if %}...{% endif %}``) counts as a *single* fragment: the body of an
    approved WhatsApp template is frozen, so the branch can only be resolved
    when the message is actually sent, and its result then becomes the value of
    one placeholder.
    """
    segments: List[Tuple[bool, str]] = []
    literal_start = 0
    fragment_start = 0
    depth = 0

    for match in _TAG_RE.finditer(source):
        tag = match.group(0)

        if depth == 0 and tag.startswith("{#"):
            # Comments carry nothing for the recipient, drop them.
            segments.append((False, source[literal_start : match.start()]))
            literal_start = match.end()
            continue

        if tag.startswith("{{"):
            if depth == 0:
                segments.append((False, source[literal_start : match.start()]))
                segments.append((True, tag))
                literal_start = match.end()
            continue

        if tag.startswith("{%"):
            name_match = _STATEMENT_NAME_RE.match(tag)
            name = name_match.group(1) if name_match else ""

            if name.startswith("end"):
                depth = max(depth - 1, 0)
                if depth == 0:
                    segments.append((True, source[fragment_start : match.end()]))
                    literal_start = match.end()
            elif name in _BLOCK_TAGS:
                if depth == 0:
                    segments.append((False, source[literal_start : match.start()]))
                    fragment_start = match.start()
                depth += 1
            elif depth == 0:
                # Standalone statement such as {% set %}: dynamic all the same.
                segments.append((False, source[literal_start : match.start()]))
                segments.append((True, tag))
                literal_start = match.end()
            # Anything else ({% else %}, {% elif %}) belongs to the open block.

    if depth:
        logger.warning("Unbalanced Jinja block in template, ignoring the tail")

    segments.append((False, source[literal_start:]))
    return [segment for segment in segments if segment[1]]


def merge_adjacent_fragments(
    segments: List[Tuple[bool, str]]
) -> List[Tuple[bool, str]]:
    """Fuse fragments separated only by whitespace into a single one.

    Meta rejects two variables sitting next to each other and recommends
    merging them into one parameter, which is exactly what rendering the pair
    as a single fragment does: "{{ first_name }} {{ last_name }}" becomes one
    value instead of two.
    """
    merged: List[Tuple[bool, str]] = []

    for is_fragment, text in segments:
        if (
            is_fragment
            and len(merged) >= 2
            and merged[-1][0] is False
            and not merged[-1][1].strip()
            and merged[-2][0] is True
        ):
            separator = merged.pop()[1]
            previous = merged.pop()[1]
            merged.append((True, previous + separator + text))
            continue
        merged.append((is_fragment, text))

    return merged


def to_placeholders(source: str, start_index: int = 1) -> Tuple[str, List[str], int]:
    """Rewrite the dynamic parts of a template as positional placeholders.

    Returns the rewritten text, the ordered list of the Jinja fragments each
    placeholder stands for, and the next free index.
    """
    parts: List[str] = []
    fragments: List[str] = []
    index = start_index

    for is_fragment, text in merge_adjacent_fragments(split_fragments(source)):
        if is_fragment:
            fragments.append(text)
            parts.append("{{%d}}" % index)
            index += 1
        else:
            parts.append(text)

    return "".join(parts), fragments, index


def build_content(
    template: "Template", language_code: str, with_action: bool
) -> Tuple[str, List[str]]:
    """Build the WhatsApp body for a template in a given language.

    Only ``template_content`` is used: WhatsApp messages have no subject, and
    neither ``twilio/text`` nor ``twilio/call-to-action`` accepts a header. This
    matches the SMS channel, which also renders the body alone.

    ``with_action`` appends the call-to-action link sentinel as the last
    variable. The resulting numbering must be reproduced identically at send
    time, which is why it is persisted on the validation.
    """
    body_source = get_localized(template, "template_content", language_code)
    body, fragments, _ = to_placeholders(body_source)
    body = close_trailing_variable(body)

    if with_action:
        fragments.append(LINK_TOKEN_EXPRESSION)

    return body, fragments


def close_trailing_variable(body: str) -> str:
    """Close a body that would otherwise end on a variable, which Meta rejects.

    Several notifications legitimately end on their payload (a code, a reminder
    text, an appointment time). Rather than reword every template in every
    language, sign the message: the site name is resolved here, at submission
    time, so what Meta approves is static text.
    """
    from constance import config

    if not _TRAILING_PLACEHOLDER_RE.search(body.strip()):
        return body

    site_name = str(config.site_name or "").strip()
    if not site_name:
        logger.warning(
            "site_name is empty, cannot close a template body ending on a variable"
        )
        return body

    return f"{body.rstrip()}\n\n\u2014 {site_name}"


def check_meta_compliance(body: str) -> List[str]:
    """List what Meta would reject in a WhatsApp template body.

    Catching this before submission turns a rejection that takes hours to come
    back into an immediate, actionable error.
    """
    problems: List[str] = []
    stripped = body.strip()

    if not stripped:
        problems.append("the body is empty")
        return problems

    if _LEADING_PLACEHOLDER_RE.match(stripped):
        problems.append(
            "the body starts with a variable, Meta requires static text first"
        )
    if _TRAILING_PLACEHOLDER_RE.search(stripped):
        problems.append(
            "the body ends with a variable, Meta requires static text last"
        )
    if _ADJACENT_PLACEHOLDERS_RE.search(stripped):
        problems.append(
            "two variables follow each other, Meta requires static text between them"
        )

    return problems


def normalize_value(value: str) -> str:
    """Fold a rendered value into what WhatsApp accepts as a parameter."""
    return _WHITESPACE_RE.sub(" ", str(value)).strip()


def render_variables(message: "Message", fragments: List[str]) -> Dict[str, str]:
    """Render the ordered fragments against a message into Twilio variables.

    Keys are the placeholder numbers as strings, which is the format the Content
    API expects both for the approval samples and for ``ContentVariables``.
    """
    variables: Dict[str, str] = {}

    for position, fragment in enumerate(fragments, start=1):
        if fragment == LINK_TOKEN_EXPRESSION:
            variables[str(position)] = message.link_token or ""
            continue
        try:
            value = normalize_value(message.render_fragment(fragment))
        except Exception as e:
            logger.error(
                "Unable to render WhatsApp variable %d (%s) for message_id=%s: %s",
                position, fragment, message.pk, e,
            )
            value = ""
        if not value:
            logger.warning(
                "WhatsApp variable %d (%s) is empty for message_id=%s, WhatsApp "
                "rejects empty parameters",
                position, fragment, message.pk,
            )
        variables[str(position)] = value

    return variables


def render_examples(fragments: List[str], obj) -> Dict[str, str]:
    """Render the ordered fragments against a factory-built object.

    Meta requires a sample value for every placeholder when a template is
    submitted for approval.
    """
    import jinja2
    from django.template.defaultfilters import register
    from django.utils import timezone

    env = jinja2.Environment(extensions=["jinja2.ext.i18n"], autoescape=False)
    env.install_null_translations(newstyle=True)
    env.filters["localtime"] = timezone.localtime
    env.filters.update(register.filters)

    examples: Dict[str, str] = {}
    for position, fragment in enumerate(fragments, start=1):
        if fragment == LINK_TOKEN_EXPRESSION:
            # Meta only checks the suffix is a plausible path, the real token is
            # supplied per message.
            examples[str(position)] = "sample"
            continue
        try:
            value = normalize_value(
                env.from_string(fragment).render({"obj": obj, "object": obj})
            )
        except Exception as e:
            logger.warning("Unable to render example for '%s': %s", fragment, e)
            value = ""
        # An empty sample is rejected by Meta, so never send one.
        examples[str(position)] = value or "sample"

    return examples
