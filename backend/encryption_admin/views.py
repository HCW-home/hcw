"""Admin views for the Encryption settings page."""

import logging

from constance import config
from django.contrib import messages
from django.contrib.auth import get_user_model
from django.http import (
    HttpResponseBadRequest,
    HttpResponseNotAllowed,
    JsonResponse,
)
from django.shortcuts import redirect
from django.template.response import TemplateResponse
from django.urls import reverse

from consultations.models import Consultation
from core.encryption import fingerprint_public_key, normalize_pem

logger = logging.getLogger(__name__)
User = get_user_model()


def _admin_context(request, admin_site, **extra):
    """Inject Unfold/admin sidebar context plus our own data."""
    return {**admin_site.each_context(request), **extra}


def settings_view_factory(admin_site):
    def settings_view(request):
        encrypted_consultations_count = Consultation.objects.filter(
            is_encrypted=True
        ).count()
        context = _admin_context(
            request,
            admin_site,
            title="Encryption",
            encryption_enabled=config.encryption_enabled,
            master_public_key=config.master_public_key,
            master_public_key_fingerprint=config.master_public_key_fingerprint,
            encrypted_consultations_count=encrypted_consultations_count,
        )
        return TemplateResponse(
            request, "admin/encryption/settings.html", context
        )

    return settings_view


def generate_master_view_factory(admin_site):
    def generate_master_view(request):
        if request.method == "POST":
            public_key_pem = (request.POST.get("public_key") or "").strip()
            if not public_key_pem.startswith("-----BEGIN PUBLIC KEY-----"):
                return HttpResponseBadRequest("Invalid PEM public key")

            had_previous = bool(config.master_public_key)
            override = request.POST.get("override") == "1"
            encrypted_count = Consultation.objects.filter(is_encrypted=True).count()
            if (
                had_previous
                and config.encryption_enabled
                and encrypted_count
                and not override
            ):
                return HttpResponseBadRequest(
                    "A master key already exists and there are encrypted "
                    "consultations. Pass override=1 to replace it; the previous "
                    "master recovery envelope on existing consultations will become "
                    "unreadable."
                )

            # Store the canonical PEM (LF-only newlines, stripped) so the
            # server, the admin browser, and any other client all hash the
            # exact same bytes when computing fingerprints.
            canonical_pem = normalize_pem(public_key_pem).decode("utf-8")
            config.master_public_key = canonical_pem
            config.master_public_key_fingerprint = fingerprint_public_key(
                canonical_pem
            )
            messages.success(
                request,
                "Master public key saved. Keep the .pem file safe — the server "
                "never sees the private master key.",
            )
            return redirect(reverse("admin:encryption_settings"))

        context = _admin_context(
            request,
            admin_site,
            title="Generate master key",
            existing_fingerprint=config.master_public_key_fingerprint,
        )
        return TemplateResponse(
            request, "admin/encryption/generate_master.html", context
        )

    return generate_master_view


def enable_view_factory(admin_site):
    def enable_view(request):
        if request.method != "POST":
            return HttpResponseNotAllowed(["POST"])
        if not config.master_public_key:
            messages.error(
                request,
                "Cannot enable encryption: master public key is not configured.",
            )
            return redirect(reverse("admin:encryption_settings"))

        from encryption_admin.tasks import provision_encryption_for_all

        config.encryption_enabled = True
        provision_encryption_for_all.delay(config.master_public_key)
        messages.success(
            request,
            "Encryption enabled. A background job is provisioning user and queue "
            "keypairs; users will receive their passphrases by email.",
        )
        return redirect(reverse("admin:encryption_settings"))

    return enable_view


def disable_view_factory(admin_site):
    def disable_view(request):
        if request.method != "POST":
            return HttpResponseNotAllowed(["POST"])
        config.encryption_enabled = False
        messages.success(
            request,
            "Encryption disabled. Existing encrypted consultations remain "
            "readable; new consultations will be created in clear.",
        )
        return redirect(reverse("admin:encryption_settings"))

    return disable_view


def user_pubkey_view_factory(admin_site):
    def user_pubkey_view(request, user_id: int):
        if request.method != "GET":
            return HttpResponseNotAllowed(["GET"])
        try:
            user = User.objects.only(
                "pk", "public_key", "public_key_fingerprint"
            ).get(pk=user_id)
        except User.DoesNotExist:
            return JsonResponse({"detail": "Not found"}, status=404)
        return JsonResponse(
            {
                "pk": user.pk,
                "public_key": user.public_key or None,
                "public_key_fingerprint": user.public_key_fingerprint or None,
            }
        )

    return user_pubkey_view


def reprovision_view_factory(admin_site):
    def reprovision_view(request):
        if request.method != "POST":
            return HttpResponseNotAllowed(["POST"])
        if not config.encryption_enabled or not config.master_public_key:
            messages.error(
                request,
                "Cannot re-provision: encryption is disabled or master key is missing.",
            )
            return redirect(reverse("admin:encryption_settings"))

        from encryption_admin.tasks import provision_encryption_for_all

        provision_encryption_for_all.delay(config.master_public_key)
        messages.success(
            request,
            "Re-provisioning job dispatched. Users without a keypair will receive "
            "their passphrase by email shortly.",
        )
        return redirect(reverse("admin:encryption_settings"))

    return reprovision_view
