"""Celery tasks for the encryption admin app."""

import logging
from typing import Iterable

from constance import config
from django.conf import settings
from django.contrib.contenttypes.models import ContentType
from django.core.mail import send_mail
from django.utils import translation
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
from users.models import User

logger = logging.getLogger(__name__)


def _email_passphrase(user: User, passphrase: str) -> None:
    """Send the one-time passphrase to a user. Never persisted server-side."""
    if not user.email:
        logger.warning("User %s has no email; skipping passphrase delivery", user.pk)
        return

    with translation.override(user.preferred_language or settings.LANGUAGE_CODE):
        subject = "Your encryption passphrase"
        body = (
            "End-to-end encryption has been enabled for your account.\n"
            f"Your personal passphrase is: {passphrase}\n\n"
            "Keep it safe — you will need it the next time you log in to "
            "decrypt your messages. Nobody at HCW can recover this passphrase "
            "for you if you lose it."
        )
        send_mail(
            subject=subject,
            message=body,
            from_email=settings.DEFAULT_FROM_EMAIL,
            recipient_list=[user.email],
            fail_silently=False,
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
