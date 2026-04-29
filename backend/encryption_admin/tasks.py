"""Celery tasks for the encryption admin app."""

import logging
from typing import Iterable

import jinja2
from constance import config
from django.conf import settings
from django.contrib.contenttypes.models import ContentType
from django.core.mail import send_mail
from django.template.defaultfilters import register
from django.utils import timezone, translation
from django_tenants.utils import get_tenant_model, tenant_context

from consultations.models import Queue, QueueMembership
from core.celery import app
from core.encryption import (
    encrypt_private_key_with_passphrase,
    fingerprint_public_key,
    generate_passphrase,
    generate_rsa_keypair,
    rsa_encrypt,
    rsa_envelope_encrypt,
)
from messaging.template import DEFAULT_NOTIFICATION_MESSAGES
from users.models import User

logger = logging.getLogger(__name__)


def _render_messaging_template(
    template_key: str, language: str, context: dict
) -> tuple[str, str, str]:
    """Render a DEFAULT_NOTIFICATION_MESSAGES template in-memory (no Message
    row persisted). Mirrors messaging.models.Message.render so the same Jinja
    helpers and i18n behavior apply, but we skip the DB persistence since
    we never want the passphrase stored anywhere on the server.
    """
    template_data = DEFAULT_NOTIFICATION_MESSAGES[template_key]
    with translation.override(language):
        env = jinja2.Environment(extensions=["jinja2.ext.i18n"])
        env.install_gettext_callables(
            translation.gettext, translation.ngettext, newstyle=True
        )
        env.filters["localtime"] = timezone.localtime
        env.filters.update(register.filters)
        full_context = {"config": config, **context}
        subject = env.from_string(str(template_data["template_subject"])).render(
            full_context
        )
        content = env.from_string(str(template_data["template_content"])).render(
            full_context
        )
        content_html = env.from_string(
            str(template_data["template_content_html"])
        ).render(full_context)
    return subject, content, content_html


def _send_email(recipient_email: str, subject: str, body: str, body_html: str) -> None:
    send_mail(
        subject=subject,
        message=body,
        from_email=settings.DEFAULT_FROM_EMAIL,
        recipient_list=[recipient_email],
        html_message=body_html,
        fail_silently=False,
    )


def _email_passphrase(user: User, passphrase: str) -> None:
    """Send the one-time passphrase, never persisted server-side.

    Routing rules:
      - Direct user with email + non-manual communication → user.email,
        template `encryption_passphrase`.
      - Manual-contact user (or user without email) but with a created_by
        practitioner who has an email → practitioner.email, template
        `encryption_passphrase_for_practitioner` carrying the patient
        identification.
      - Otherwise → log a warning, no delivery is possible.
    """
    is_manual = (
        getattr(user, "communication_method", None) == "manual" or not user.email
    )
    creator = getattr(user, "created_by", None)

    if not is_manual and user.email:
        language = user.preferred_language or settings.LANGUAGE_CODE
        subject, body, body_html = _render_messaging_template(
            "encryption_passphrase",
            language,
            {"user": user, "passphrase": passphrase, "obj": user},
        )
        _send_email(user.email, subject, body, body_html)
        return

    if creator and creator.email:
        language = creator.preferred_language or settings.LANGUAGE_CODE
        subject, body, body_html = _render_messaging_template(
            "encryption_passphrase_for_practitioner",
            language,
            {
                "passphrase": passphrase,
                "patient_id": user.pk,
                "patient_first_name": user.first_name or "",
                "patient_last_name": user.last_name or "",
                "patient_email": user.email or "",
                "obj": user,
            },
        )
        _send_email(creator.email, subject, body, body_html)
        logger.info(
            "Passphrase for user %s routed to its creator %s (manual contact)",
            user.pk, creator.pk,
        )
        return

    logger.warning(
        "Cannot deliver passphrase for user %s: no usable email "
        "(communication_method=%s, has_email=%s, has_creator_email=%s)",
        user.pk,
        getattr(user, "communication_method", None),
        bool(user.email),
        bool(creator and creator.email),
    )


def _provision_user_keypair(user: User) -> None:
    """Generate a keypair for a user, email them their passphrase, save."""
    private_pem, public_pem = generate_rsa_keypair()
    passphrase = generate_passphrase()
    encrypted_private = encrypt_private_key_with_passphrase(private_pem, passphrase)
    public_pem_str = public_pem.decode("utf-8")

    user.public_key = public_pem_str
    user.public_key_fingerprint = fingerprint_public_key(public_pem_str)
    user.encrypted_private_key = encrypted_private
    user.encryption_passphrase_pending = True
    user.encryption_key_lost = False
    user.save(
        update_fields=[
            "public_key",
            "public_key_fingerprint",
            "encrypted_private_key",
            "encryption_passphrase_pending",
            "encryption_key_lost",
        ]
    )

    try:
        _email_passphrase(user, passphrase)
    except Exception:
        logger.exception(
            "Failed to email encryption passphrase to user %s", user.pk
        )
    finally:
        del passphrase


def _provision_queue_keypair(queue: Queue, master_public_key: str) -> None:
    """Generate a queue keypair, wrap private for master + each member.

    The queue's PEM private key is too large to fit in a single RSA-OAEP
    block, so we use envelope encryption (AES-GCM + RSA-wrapped CEK).
    """
    private_pem, public_pem = generate_rsa_keypair()
    public_pem_str = public_pem.decode("utf-8")

    queue.public_key = public_pem_str
    queue.public_key_fingerprint = fingerprint_public_key(public_pem_str)
    queue.encrypted_queue_private_key_master = rsa_envelope_encrypt(
        private_pem, master_public_key
    )
    queue.save(
        update_fields=[
            "public_key",
            "public_key_fingerprint",
            "encrypted_queue_private_key_master",
        ]
    )

    memberships = QueueMembership.objects.filter(queue=queue).select_related("user")
    for membership in memberships:
        if not membership.user.public_key:
            logger.info(
                "Skipping queue membership q=%s u=%s: user has no pubkey yet",
                queue.pk, membership.user.pk,
            )
            continue
        membership.encrypted_queue_private_key = rsa_envelope_encrypt(
            private_pem, membership.user.public_key
        )
        membership.save(update_fields=["encrypted_queue_private_key"])

    del private_pem


@app.task
def provision_encryption_for_all(master_public_key_pem: str):
    """Run once when the platform admin enables encryption.

    Generates a keypair for every active user (with a one-time emailed
    passphrase) and a keypair for every queue (wrapped for the master and
    for each member's pubkey). Idempotent: users/queues that already have
    a public_key are skipped, so re-running the task only fills the gaps.
    """
    TenantModel = get_tenant_model()
    for tenant in TenantModel.objects.exclude(schema_name="public"):
        with tenant_context(tenant):
            users_to_provision = User.objects.filter(
                is_active=True, public_key__isnull=True
            )
            for user in users_to_provision:
                try:
                    _provision_user_keypair(user)
                except Exception:
                    logger.exception(
                        "Failed to provision keypair for user %s", user.pk
                    )

            queues_to_provision = Queue.objects.filter(public_key__isnull=True)
            for queue in queues_to_provision:
                try:
                    _provision_queue_keypair(queue, master_public_key_pem)
                except Exception:
                    logger.exception(
                        "Failed to provision keypair for queue %s", queue.pk
                    )

            queues_with_unwrapped_members = Queue.objects.filter(
                public_key__isnull=False,
                queuemembership__encrypted_queue_private_key__isnull=True,
            ).distinct()
            if queues_with_unwrapped_members.exists():
                logger.warning(
                    "Some queue memberships still lack wrapped private keys "
                    "in tenant %s; re-run after users finish provisioning.",
                    tenant.schema_name,
                )


def _run_in_tenant(schema_name: str, fn):
    TenantModel = get_tenant_model()
    try:
        tenant = TenantModel.objects.get(schema_name=schema_name)
    except TenantModel.DoesNotExist:
        logger.error("Tenant %s not found; skipping", schema_name)
        return
    with tenant_context(tenant):
        fn()


@app.task
def provision_single_user(user_id: int, schema_name: str):
    """Provision a keypair for a single newly-created user (signal hook)."""
    def _do():
        try:
            user = User.objects.get(pk=user_id)
        except User.DoesNotExist:
            logger.warning("User %s no longer exists; skipping provisioning", user_id)
            return
        if user.public_key:
            return
        if not user.is_active:
            return
        _provision_user_keypair(user)

    _run_in_tenant(schema_name, _do)


@app.task
def provision_single_queue(queue_id: int, master_public_key_pem: str, schema_name: str):
    """Provision a keypair for a single newly-created queue (signal hook)."""
    def _do():
        try:
            queue = Queue.objects.get(pk=queue_id)
        except Queue.DoesNotExist:
            logger.warning("Queue %s no longer exists; skipping provisioning", queue_id)
            return
        if queue.public_key:
            return
        _provision_queue_keypair(queue, master_public_key_pem)

    _run_in_tenant(schema_name, _do)
