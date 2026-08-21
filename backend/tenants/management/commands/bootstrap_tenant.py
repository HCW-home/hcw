"""Bootstrap an HCW@Home tenant (single organisation).

Every option falls back to the matching environment variable, so the command
can be driven either by explicit flags or by the container environment:

    docker compose exec -T api python3 manage.py bootstrap_tenant \
        --schema acme --primary-domain acme.example.org \
        --superuser-email admin@example.org --superuser-password secret

The command is IDEMPOTENT: it can be re-run without duplicating objects.
"""

import os

from allauth.socialaccount.models import SocialApp
from constance import config
from django.conf import settings
from django.contrib.auth import get_user_model
from django.core.management.base import BaseCommand, CommandError
from django_tenants.utils import schema_context

from mediaserver.models import Server
from messaging.models import CommunicationMethod, MessagingProvider
from tenants.models import Domain, Tenant

User = get_user_model()

TRUTHY = {"1", "true", "yes", "on"}


def _env(name, default=None):
    """Environment fallback used as the default value of an option."""
    value = os.getenv(name)
    return value if value else default


def _env_flag(name, default=False):
    value = os.getenv(name)
    if value is None:
        return default
    return value.strip().lower() in TRUTHY


def _as_bool(value):
    """Normalize a setting that may reach us as a raw environment string."""
    if isinstance(value, str):
        return value.strip().lower() in TRUTHY
    return bool(value)


class Command(BaseCommand):
    help = (
        "Bootstrap a tenant: schema, domains, superuser, LiveKit server, email "
        "provider, SSO and public URLs. Idempotent, every option defaults to "
        "its matching environment variable."
    )

    def add_arguments(self, parser):
        tenant = parser.add_argument_group("tenant")
        tenant.add_argument(
            "--schema",
            default=_env("TENANT_SCHEMA"),
            help="Required. Tenant schema name (env: TENANT_SCHEMA).",
        )
        tenant.add_argument(
            "--name",
            default=_env("TENANT_NAME"),
            help="Human readable tenant name, defaults to --schema (env: TENANT_NAME).",
        )
        tenant.add_argument(
            "--primary-domain",
            default=_env("TENANT_PRIMARY_DOMAIN"),
            help="Required. Primary practitioner domain (env: TENANT_PRIMARY_DOMAIN).",
        )
        tenant.add_argument(
            "--patient-domain",
            default=_env("TENANT_PATIENT_DOMAIN"),
            help="Patient frontend domain (env: TENANT_PATIENT_DOMAIN).",
        )
        tenant.add_argument(
            "--admin-domain",
            default=_env("TENANT_ADMIN_DOMAIN"),
            help="Admin domain (env: TENANT_ADMIN_DOMAIN).",
        )
        tenant.add_argument(
            "--practitioner-base-url",
            default=_env("PRACTITIONER_BASE_URL"),
            help=(
                "Public URL of the practitioner frontend, defaults to "
                "https://<primary domain> (env: PRACTITIONER_BASE_URL)."
            ),
        )
        tenant.add_argument(
            "--patient-base-url",
            default=_env("PATIENT_BASE_URL"),
            help=(
                "Public URL of the patient frontend, defaults to "
                "https://<patient domain> (env: PATIENT_BASE_URL)."
            ),
        )

        superuser = parser.add_argument_group("superuser")
        superuser.add_argument(
            "--superuser-email",
            default=_env("SUPERUSER_EMAIL"),
            help="Required. Superuser email address (env: SUPERUSER_EMAIL).",
        )
        superuser.add_argument(
            "--superuser-password",
            default=_env("SUPERUSER_PASSWORD"),
            help="Required. Superuser password (env: SUPERUSER_PASSWORD).",
        )
        superuser.add_argument(
            "--reset-superuser-password",
            action="store_true",
            default=_env_flag("SUPERUSER_RESET_PASSWORD"),
            help="Reset the password when the superuser already exists.",
        )

        livekit = parser.add_argument_group("livekit")
        livekit.add_argument(
            "--livekit-url",
            default=_env("LIVEKIT_URL"),
            help="LiveKit server URL (env: LIVEKIT_URL).",
        )
        livekit.add_argument(
            "--livekit-api-key",
            default=_env("LIVEKIT_API_KEY"),
            help="LiveKit API key (env: LIVEKIT_API_KEY).",
        )
        livekit.add_argument(
            "--livekit-api-secret",
            default=_env("LIVEKIT_API_SECRET"),
            help="LiveKit API secret (env: LIVEKIT_API_SECRET).",
        )

        messaging = parser.add_argument_group("messaging")
        messaging.add_argument(
            "--messaging-from-email",
            default=_env("MESSAGING_FROM_EMAIL") or _env("EMAIL_HOST_USER"),
            help=(
                "Sender of the email provider, bare address without display "
                "name (env: MESSAGING_FROM_EMAIL, then EMAIL_HOST_USER)."
            ),
        )

        sso = parser.add_argument_group("sso")
        sso.add_argument(
            "--sso-provider-id",
            default=_env("SSO_PROVIDER_ID", "openid"),
            help="OpenID Connect provider id, must match the frontend (env: SSO_PROVIDER_ID).",
        )
        sso.add_argument(
            "--sso-name",
            default=_env("SSO_NAME", "Keycloak"),
            help="Display name of the SSO provider (env: SSO_NAME).",
        )
        sso.add_argument(
            "--sso-client-id",
            default=_env("SSO_CLIENT_ID"),
            help="OIDC client id, enables the SSO block (env: SSO_CLIENT_ID).",
        )
        sso.add_argument(
            "--sso-client-secret",
            default=_env("SSO_CLIENT_SECRET"),
            help="OIDC client secret (env: SSO_CLIENT_SECRET).",
        )
        sso.add_argument(
            "--sso-server-url",
            default=_env("SSO_SERVER_URL"),
            help=(
                "OIDC discovery URL, enables the SSO block, e.g. https://kc/"
                "realms/<realm>/.well-known/openid-configuration (env: SSO_SERVER_URL)."
            ),
        )
        sso.add_argument(
            "--sso-disable-password-login",
            action="store_true",
            default=_env_flag("SSO_DISABLE_PASSWORD_LOGIN"),
            help="Force login through SSO only, never re-enables password login.",
        )

        checks = parser.add_argument_group("checks")
        checks.add_argument(
            "--skip-email-check",
            action="store_true",
            help="Skip the SMTP configuration sanity check.",
        )
        checks.add_argument(
            "--skip-s3-check",
            action="store_true",
            help="Skip the S3 configuration check and its head_bucket call.",
        )

    def handle(self, *args, **options):
        schema = options["schema"]
        primary_domain = options["primary_domain"]
        patient_domain = options["patient_domain"]
        superuser_email = options["superuser_email"]
        superuser_password = options["superuser_password"]

        missing = [
            flag
            for flag, value in (
                ("--schema", schema),
                ("--primary-domain", primary_domain),
                ("--superuser-email", superuser_email),
                ("--superuser-password", superuser_password),
            )
            if not value
        ]
        if missing:
            raise CommandError("Missing required options: " + ", ".join(missing))

        tenant = self._sync_tenant(schema, options["name"] or schema)
        self._sync_domains(
            tenant, primary_domain, patient_domain, options["admin_domain"]
        )

        with schema_context(schema):
            self._sync_superuser(
                superuser_email,
                superuser_password,
                options["reset_superuser_password"],
            )
            self._sync_livekit(
                options["livekit_url"],
                options["livekit_api_key"],
                options["livekit_api_secret"],
            )
            self._sync_messaging(options["messaging_from_email"])
            self._sync_sso(options)
            self._sync_urls(
                primary_domain,
                patient_domain,
                options["practitioner_base_url"],
                options["patient_base_url"],
            )

        if not options["skip_email_check"]:
            self._check_email(options["messaging_from_email"])
        if not options["skip_s3_check"]:
            self._check_s3()

        self.stdout.write(self.style.SUCCESS("Bootstrap done."))

    # --- Tenant and domains (public schema) ----------------------------------

    def _sync_tenant(self, schema, name):
        tenant, created = Tenant.objects.get_or_create(
            schema_name=schema, defaults={"name": name}
        )
        self._report(f"Tenant {schema}", created)
        return tenant

    def _sync_domains(self, tenant, primary_domain, patient_domain, admin_domain):
        domains = [
            (primary_domain, True),
            (patient_domain, False),
            (admin_domain, False),
        ]
        for domain_name, is_primary in domains:
            if not domain_name:
                continue
            _, created = Domain.objects.get_or_create(
                domain=domain_name,
                defaults={"tenant": tenant, "is_primary": is_primary},
            )
            self._report(f"Domain {domain_name}", created)

    # --- Objects living inside the tenant schema -----------------------------

    def _sync_superuser(self, email, password, reset_password):
        user = User.objects.find_by_email(email)
        if user is None:
            User.objects.create_superuser(email, password)
            self.stdout.write(self.style.SUCCESS(f"Superuser {email} created"))
            return

        if reset_password:
            user.set_password(password)
            user.save(update_fields=["password"])
            self.stdout.write(self.style.SUCCESS(f"Superuser {email} password reset"))
        else:
            self.stdout.write(f"Superuser {email} already present")

    def _sync_livekit(self, url, api_key, api_secret):
        if not (url and api_key and api_secret):
            self.stdout.write(
                "LiveKit not configured (url/key/secret missing) - skipped"
            )
            return

        server, created = Server.objects.get_or_create(
            url=url,
            type="livekit",
            defaults={"api_token": api_key, "api_secret": api_secret},
        )
        # Keep the credentials up to date even when the server already existed
        if not created:
            server.api_token = api_key
            server.api_secret = api_secret
            server.save(update_fields=["api_token", "api_secret"])
        self._report(f"LiveKit server {url}", created, updated_label="updated")

    def _sync_messaging(self, from_email):
        if not from_email:
            self.stdout.write(
                self.style.WARNING(
                    "Email provider not created: --messaging-from-email and "
                    "EMAIL_HOST_USER are both empty"
                )
            )
            return

        _, created = MessagingProvider.objects.get_or_create(
            name="email",
            communication_method=CommunicationMethod.email,
            defaults={"from_email": from_email},
        )
        self._report("Email provider", created)

    def _sync_sso(self, options):
        # django-allauth SocialApp. allauth.socialaccount is a tenant app, so
        # the SocialApp lives in the tenant schema. django.contrib.sites is not
        # installed, no Site association is needed.
        client_id = options["sso_client_id"]
        server_url = options["sso_server_url"]
        if not (client_id and server_url):
            self.stdout.write(
                "SSO not configured (client id / server url missing) - skipped"
            )
            return

        provider_id = options["sso_provider_id"]
        values = {
            "name": options["sso_name"],
            "client_id": client_id,
            "secret": options["sso_client_secret"] or "",
            "settings": {"server_url": server_url},
        }
        app, created = SocialApp.objects.get_or_create(
            provider="openid_connect", provider_id=provider_id, defaults=values
        )
        if not created:
            for field, value in values.items():
                setattr(app, field, value)
            app.save(update_fields=list(values))
        self._report(
            f"SSO OpenID Connect '{provider_id}'", created, updated_label="updated"
        )

        # Only ever turns the flag on, so a manual re-activation of password
        # login is not silently reverted on the next run.
        if options["sso_disable_password_login"]:
            config.disable_password_login = True
            self.stdout.write("Password login disabled (SSO only)")

    def _sync_urls(
        self, primary_domain, patient_domain, practitioner_base_url, patient_base_url
    ):
        # Explicit base URLs win, otherwise assume https on the tenant domains
        practitioner_url = practitioner_base_url or f"https://{primary_domain}"
        patient_url = patient_base_url or (
            f"https://{patient_domain}" if patient_domain else None
        )

        config.practitioner_base_url = practitioner_url
        self.stdout.write(f"Practitioner base URL set to {practitioner_url}")
        if patient_url:
            config.patient_base_url = patient_url
            self.stdout.write(f"Patient base URL set to {patient_url}")

    # --- Process level configuration, nothing stored in database -------------

    def _check_email(self, messaging_from_email):
        # Django reads EMAIL_* at startup: this only reports an absent or
        # inconsistent configuration, it writes nothing.
        host = settings.EMAIL_HOST
        if not host:
            self.stdout.write(
                self.style.WARNING("EMAIL_HOST missing - sending emails is impossible")
            )
            return

        port = str(settings.EMAIL_PORT or "")
        use_ssl = _as_bool(settings.EMAIL_USE_SSL)
        use_tls = _as_bool(settings.EMAIL_USE_TLS)
        warnings = []

        if not settings.EMAIL_HOST_USER:
            warnings.append("EMAIL_HOST_USER empty (usually required for SMTP auth)")
        if not settings.EMAIL_HOST_PASSWORD:
            warnings.append(
                "EMAIL_HOST_PASSWORD empty (usually required for SMTP auth)"
            )
        if not settings.DEFAULT_FROM_EMAIL and not messaging_from_email:
            warnings.append("no default sender (DEFAULT_FROM_EMAIL and from email empty)")
        if use_ssl and use_tls:
            warnings.append(
                "EMAIL_USE_SSL and EMAIL_USE_TLS are mutually exclusive (465 -> SSL, 587 -> TLS)"
            )
        if not use_ssl and not use_tls and port not in ("", "25"):
            warnings.append(
                f"EMAIL_PORT={port} without SSL/TLS, check the encryption (465 -> SSL, 587 -> TLS)"
            )

        if warnings:
            for message in warnings:
                self.stdout.write(self.style.WARNING(f"Email warning: {message}"))
            return

        encryption = "SSL" if use_ssl else ("TLS" if use_tls else "no encryption")
        self.stdout.write(
            f"SMTP configured (host={host}, port={port or '25'}, {encryption})"
        )

    def _check_s3(self):
        # settings.py already rejects a partial S3 configuration at startup, so
        # here we only report the active backend and probe the bucket.
        bucket = getattr(settings, "S3_BUCKET_NAME", None)
        if not bucket:
            self.stdout.write("S3 not configured - local filesystem storage")
            return

        endpoint = getattr(settings, "S3_ENDPOINT_URL", None)
        region = getattr(settings, "S3_REGION", None)
        addressing = getattr(settings, "S3_ADDRESSING_STYLE", None) or "auto"
        backend = (getattr(settings, "STORAGES", {}).get("default") or {}).get(
            "BACKEND", ""
        )
        if "s3" not in backend.lower():
            self.stdout.write(
                self.style.WARNING(
                    "S3_* set but STORAGES does not use S3Storage - restart "
                    "api/celery/scheduler after changing the environment"
                )
            )
        else:
            self.stdout.write(
                f"S3 enabled (bucket={bucket}, endpoint={endpoint}, "
                f"region={region}, addressing={addressing})"
            )

        # Read only connectivity probe, safe to re-run
        try:
            import boto3
            from botocore.client import Config as BotoConfig

            client = boto3.client(
                "s3",
                endpoint_url=endpoint,
                aws_access_key_id=getattr(settings, "S3_ACCESS_KEY", None),
                aws_secret_access_key=getattr(settings, "S3_SECRET_KEY", None),
                region_name=region,
                verify=False if getattr(settings, "S3_VERIFY", None) == "false" else True,
                config=BotoConfig(s3={"addressing_style": addressing}),
            )
            client.head_bucket(Bucket=bucket)
            self.stdout.write(self.style.SUCCESS(f"S3 reachable (head_bucket {bucket})"))
        except Exception as exc:
            self.stdout.write(self.style.WARNING(f"S3 access failed - {exc}"))

    def _report(self, label, created, updated_label="already present"):
        style = self.style.SUCCESS if created else self.style.NOTICE
        self.stdout.write(style(f"{label} {'created' if created else updated_label}"))
