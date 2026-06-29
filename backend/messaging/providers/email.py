import logging
import mimetypes
from email import encoders as Encoders
from email.mime.base import MIMEBase
from email.mime.image import MIMEImage
from typing import TYPE_CHECKING, Any, Tuple

from constance import config
from django.conf import settings
from django.core.mail import EmailMultiAlternatives, get_connection
from django.core.mail.message import SafeMIMEMultipart
from django.utils.translation import gettext_lazy as _

from . import BaseMessagingProvider

if TYPE_CHECKING:
    from ..models import Message

logger = logging.getLogger(__name__)


class EmailWithInlineImages(EmailMultiAlternatives):
    """EmailMultiAlternatives that nests the text/html alternative group plus
    inline (Content-ID) images inside a multipart/related, while keeping real
    file attachments (e.g. ICS) in the outer multipart/mixed.

    Resulting tree:
        multipart/mixed
        |-- multipart/related
        |   |-- multipart/alternative [text/plain, text/html(cid:..)]
        |   `-- <inline images>
        `-- <regular attachments>
    """

    def __init__(self, *args, inline_attachments=None, **kwargs):
        super().__init__(*args, **kwargs)
        self.inline_attachments = list(inline_attachments or [])

    def attach_inline(self, mime_part):
        self.inline_attachments.append(mime_part)

    def _create_message(self, msg):
        # text/plain + text/html -> multipart/alternative
        msg = self._create_alternatives(msg)
        # wrap alternative + inline images -> multipart/related
        if self.inline_attachments:
            related = SafeMIMEMultipart(
                _subtype="related",
                encoding=self.encoding or settings.DEFAULT_CHARSET,
            )
            related.attach(msg)
            for part in self.inline_attachments:
                related.attach(part)
            msg = related
        # wrap with real attachments -> multipart/mixed
        return self._create_attachments(msg)


class Main(BaseMessagingProvider):
    display_name = _("Email over Django SMTP")
    communication_method = "email"
    required_fields = ["from_email"]

    def send(self, message: "Message"):
        from users.models import Organisation

        from_email = self.messaging_provider.from_email or settings.DEFAULT_FROM_EMAIL
        logger.info(
            "Preparing email message_id=%s to=%s from=%s",
            message.pk, message.email, from_email,
        )

        subject = message.render_subject or "Message from HCW"
        logger.debug("Subject: %s", subject)

        body = message.render_content
        logger.debug("Plain text body length: %d", len(body) if body else 0)

        html_body = message.render_full_html
        logger.debug("HTML body length: %d", len(html_body) if html_body else 0)

        email = EmailWithInlineImages(
            subject=subject,
            body=body,
            from_email=from_email,
            to=[message.email],
        )

        email.attach_alternative(html_body, "text/html")

        # Attach logo inline only in "embed" mode. In "url" mode the HTML links
        # to the media file directly (see Message.render_full_html), so no
        # attachment is needed.
        logo_mode = getattr(config, "email_logo_mode", "embed")
        main_org = Organisation.objects.filter(is_main=True).first()
        if logo_mode == "embed" and main_org and main_org.logo_white:
            try:
                with main_org.logo_white.open("rb") as fh:
                    logo_data = fh.read()

                mime_type = mimetypes.guess_type(main_org.logo_white.name)[0] or "image/png"
                maintype, subtype = mime_type.split("/", 1)

                if maintype == "image" and subtype not in ("svg+xml",):
                    img = MIMEImage(logo_data, _subtype=subtype)  # auto base64
                else:
                    # SVG and other non-standard image types must be base64
                    # encoded explicitly, like Django does for attachments.
                    img = MIMEBase(maintype, subtype)
                    img.set_payload(logo_data)
                    Encoders.encode_base64(img)

                img.add_header("Content-ID", "<logo>")
                img.add_header("Content-Disposition", "inline", filename="logo")
                # Inline image -> goes into the multipart/related group so the
                # cid:logo reference in the HTML resolves. Real attachments
                # (ICS below) stay in the outer multipart/mixed.
                email.attach_inline(img)
            except Exception as e:
                logger.warning("Failed to attach inline logo: %s", e)

        # Attach ICS file if available (for appointments)
        ics_data = message.ics_attachment
        if ics_data:
            filename, content, mime_type = ics_data
            email.attach(filename, content, mime_type)
            logger.debug("Attached ICS file: %s", filename)

        logger.info(
            "Sending email message_id=%s via EMAIL_HOST=%s EMAIL_PORT=%s EMAIL_USE_SSL=%s",
            message.pk,
            getattr(settings, "EMAIL_HOST", None),
            getattr(settings, "EMAIL_PORT", None),
            getattr(settings, "EMAIL_USE_SSL", None),
        )
        result = email.send()
        logger.info("Email send result for message_id=%s: %s", message.pk, result)

    def test_connection(self):
        if not hasattr(settings, "EMAIL_HOST") or not settings.EMAIL_HOST:
            raise Exception("EMAIL_HOST setting is required")

        from_email = self.messaging_provider.from_email or getattr(
            settings, "DEFAULT_FROM_EMAIL", None
        )
        if not from_email:
            raise Exception("from_email is required")

        connection = get_connection()
        connection.open()
        connection.close()
