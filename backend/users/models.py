import uuid
from zoneinfo import ZoneInfo, available_timezones

from asgiref.sync import async_to_sync
from channels.layers import get_channel_layer
from django.conf import settings
from django.contrib.auth.models import AbstractUser
from django.contrib.contenttypes.fields import GenericRelation
from django.core.validators import MaxValueValidator, MinValueValidator
from django.db import models
from django.db.models.fields import BLANK_CHOICE_DASH
from django.db.models import Q
from django.db.models.functions import Lower
from django.utils import timezone
from django.utils.translation import gettext_lazy as _
from fcm_django.models import AbstractFCMDevice, FirebaseResponseDict
from firebase_admin.messaging import Message
from firebase_admin.messaging import Notification as FireBaseNotification
from location_field.models.plain import PlainLocationField
from messaging.models import CommunicationMethod

from core.storage import TenantUploadTo

from .abstracts import ModelOwnerAbstract
from .managers import UserManager
from .phone import MAX_PHONE_LENGTH, normalize_phone_number
from .validators import validate_phone_number
from .verification import (
    MAX_VERIFICATION_ATTEMPTS,
    VERIFICATION_CODE_RESEND_DELAY,
    VERIFICATION_CODE_REUSE_WINDOW,
    generate_verification_code,
)

import secrets

# Create your models here.


class Term(models.Model):
    name = models.CharField()
    content = models.TextField()
    # valid_until = models.DateTimeField(null=True, blank=True)
    use_for_patient = models.BooleanField(default=False)

    def __str__(self):
        return self.name

    def save(self, *args, **kwargs):
        if self.use_for_patient:
            # Save first if this is a new instance to get a pk
            is_new = self.pk is None
            if is_new:
                super().save(*args, **kwargs)
            # Set all other terms to False
            Term.objects.exclude(pk=self.pk).update(use_for_patient=False)
            # Save again only if it's an existing instance
            if not is_new:
                super().save(*args, **kwargs)
        else:
            super().save(*args, **kwargs)


class Organisation(models.Model):
    name = models.CharField(max_length=200)
    logo_color = models.ImageField(upload_to=TenantUploadTo("organisations"), blank=True, null=True)
    logo_white = models.ImageField(upload_to=TenantUploadTo("organisations"), blank=True, null=True)
    favicon = models.ImageField(upload_to=TenantUploadTo("organisations"), blank=True, null=True)
    primary_color_patient = models.CharField(max_length=7, default="#0891b2")
    primary_color_practitioner = models.CharField(max_length=7, default="#0891b2")
    default_term = models.ForeignKey(
        Term, on_delete=models.SET_NULL, null=True, blank=True
    )
    location = PlainLocationField(based_fields=["city"], zoom=7, blank=True, null=True)
    street = models.CharField(max_length=200, blank=True, null=True)
    city = models.CharField(max_length=50, blank=True, null=True)
    postal_code = models.CharField(max_length=10, blank=True, null=True)
    country = models.CharField(max_length=50, blank=True, null=True)
    phone = models.CharField(max_length=20, blank=True, null=True)
    # RPPS publishes one email per site, shared by everyone practising there,
    # so it describes the structure and not a person. Not unique: groups and
    # chains reuse a single address across several sites.
    email = models.EmailField(blank=True, null=True)
    login_text_patient = models.TextField(blank=True, null=True)
    login_text_practitioner = models.TextField(blank=True, null=True)
    footer_patient = models.TextField(blank=True, null=True)
    footer_practitioner = models.TextField(blank=True, null=True)

    is_main = models.BooleanField(
        default=False,
        help_text="Define is this organisation will be default for patient",
    )
    imported = models.BooleanField(default=False)

    def __str__(self):
        return self.name

    def save(self, *args, **kwargs):
        if self.is_main:
            domain_list = self.__class__.objects.filter(is_main=True).exclude(
                pk=self.pk
            )
            domain_list.update(is_main=False)

        return super().save(*args, **kwargs)


class Language(models.Model):
    name = models.CharField(max_length=100)
    code = models.CharField(max_length=3, unique=True)

    def __str__(self):
        return self.name


class Speciality(models.Model):
    name = models.CharField(_("name"), max_length=100)
    icon = models.ImageField(upload_to=TenantUploadTo("specialities"), blank=True, null=True, help_text=_("Custom icon for this speciality."))

    class Meta:
        verbose_name = _("speciality")
        verbose_name_plural = _("specialities")

    def __str__(self):
        return self.name


class FCMDeviceOverride(AbstractFCMDevice):
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)


class WebPushSubscription(models.Model):
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="webpush_subscriptions",
    )
    endpoint = models.URLField(max_length=500, unique=True)
    p256dh = models.CharField(
        max_length=200,
        help_text="Client public key for encryption",
    )
    auth = models.CharField(
        max_length=200,
        help_text="Client auth secret",
    )
    browser = models.CharField(max_length=100, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    is_active = models.BooleanField(default=True)

    class Meta:
        verbose_name = _("web push subscription")
        verbose_name_plural = _("web push subscriptions")

    def __str__(self):
        return f"WebPush for {self.user} ({self.endpoint[:50]}...)"

    @property
    def subscription_info(self):
        return {
            "endpoint": self.endpoint,
            "keys": {
                "p256dh": self.p256dh,
                "auth": self.auth,
            },
        }


class Gender(models.TextChoices):
    male = "male", _("Male")
    female = "female", _("Female")
    other = "other", _("Other")
    unknown = "unknown", _("Unknown")


class User(AbstractUser):
    def __str__(self):
        return self.name

    objects = UserManager()

    USERNAME_FIELD = "email"
    REQUIRED_FIELDS = []

    username = None

    email = models.EmailField(_("email address"), blank=True, null=True, unique=True)
    updated_at = models.DateTimeField(_("updated at"), auto_now=True, null=True)
    date_of_birth = models.DateField(_("date of birth"), null=True, blank=True)
    gender = models.CharField(
        _("gender"),
        max_length=10,
        choices=Gender.choices,
        default=Gender.unknown,
    )

    app_preferences = models.JSONField(null=True, blank=True)
    encrypted = models.BooleanField(default=False)

    public_key = models.TextField(blank=True, null=True)
    public_key_fingerprint = models.CharField(max_length=64, blank=True, null=True)
    encrypted_private_key = models.TextField(blank=True, null=True)
    encryption_passphrase_pending = models.BooleanField(default=False)
    encryption_key_lost = models.BooleanField(default=False)

    picture = models.ImageField(upload_to=TenantUploadTo("users"), blank=True, null=True)

    job_title = models.CharField(
        max_length=200,
        blank=True,
        null=True,
        help_text="Job title or professional designation",
    )

    languages = models.ManyToManyField(Language, blank=True)

    preferred_language = models.CharField(
        max_length=10,
        choices=settings.LANGUAGES,
        help_text="Preferred language for the user interface",
        null=True,
        blank=True,
    )

    last_notification = models.DateTimeField(default=timezone.now)

    specialities = models.ManyToManyField(Speciality, blank=True)
    organisations = models.ManyToManyField("users.Organisation", blank=True)
    accepted_term = models.ForeignKey(
        Term, on_delete=models.SET_NULL, null=True, blank=True
    )
    main_organisation = models.ForeignKey(
        "users.Organisation",
        blank=True,
        null=True,
        on_delete=models.SET_NULL,
        related_name="users_mainorganisation",
    )
    communication_method = models.CharField(
        choices=CommunicationMethod.choices, default=CommunicationMethod.email
    )
    mobile_phone_number = models.CharField(
        max_length=MAX_PHONE_LENGTH,
        null=True,
        blank=True,
        unique=True,
        validators=[validate_phone_number],
    )
    timezone = models.CharField(
        max_length=63,
        choices=[(tz, tz) for tz in sorted(available_timezones())],
        default=settings.TIME_ZONE,
        help_text="User timezone for displaying dates and times",
    )
    location = PlainLocationField(
        based_fields=["city"], zoom=7, blank=True, null=True
    )
    street = models.CharField(max_length=200, blank=True, null=True)
    city = models.CharField(max_length=50, blank=True, null=True)
    postal_code = models.CharField(max_length=10, blank=True, null=True)
    country = models.CharField(max_length=50, blank=True, null=True)
    imported = models.BooleanField(default=False)

    # Authentication fields (moved from Participant)
    temporary = models.BooleanField(
        default=False,
        help_text="Indicates if this is a temporary user created for appointments",
    )
    one_time_auth_token = models.CharField(
        max_length=256,
        blank=True,
        null=True,
        help_text="Authentication token for appointment access",
    )
    verification_code = models.IntegerField(null=True, blank=True)
    # Despite its name, this dates one_time_auth_token: it starts the grace
    # period of a magic link and, for accounts signing in without a code, its
    # expiry. The code itself is dated by the two fields below.
    verification_code_created_at = models.DateTimeField(null=True, blank=True)
    verification_code_issued_at = models.DateTimeField(
        null=True,
        blank=True,
        help_text="When the pending verification code was generated",
    )
    verification_code_sent_at = models.DateTimeField(
        null=True,
        blank=True,
        help_text="When the pending verification code was last sent",
    )
    verification_attempts = models.IntegerField(default=0)

    email_verified = models.BooleanField(
        default=False,
        help_text="Whether the user's email address has been verified",
    )

    created_by = models.ForeignKey(
        "self",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="created_users",
        help_text="The practitioner who created this user",
    )
    is_practitioner = models.BooleanField(
        default=False,
        help_text="Whether this user is a practitioner",
    )
    is_first_login = models.BooleanField(
        default=True,
        help_text="Whether to show the first login dialog asking for preferred language and communication methods",
    )

    # Hidden from native API; only exposed via FHIR Patient/Practitioner.identifier.
    external_id = models.CharField(
        _("external id"),
        max_length=255,
        null=True,
        blank=True,
        db_index=True,
        help_text=_(
            "Identifier from an external system (e.g. OpenMRS). "
            "Hidden from native API; exposed only via FHIR identifier array."
        ),
    )

    notification_messages = GenericRelation("messaging.Message")

    @property
    def is_online(self):
        from .services import user_online_service
        return user_online_service.is_user_online(self.pk)

    @property
    def is_patient(self):
        return not self.is_practitioner

    @property
    def requires_manual_access(self):
        """Whether this user needs a manually-shared access link.

        True only when no channel can deliver the link automatically: either
        the communication method is explicitly ``manual``, or the user has
        neither an email nor a phone number. A user reachable by email, SMS or
        WhatsApp receives the access link automatically (the link is embedded in
        the message), so no manual link is needed.
        """
        return self.communication_method == CommunicationMethod.manual or (
            not self.email and not self.mobile_phone_number
        )

    def issue_verification_code(self, keep_auth_token=False) -> bool:
        """Make sure a code is pending for this user; return whether to send it.

        A code asked for again while it is fresh goes out again unchanged, so
        every message received in the meantime carries a code that works,
        whichever one the person opens. Its attempt counter is left alone on
        purpose: resetting it would hand out unlimited guesses on the very same
        code. Within ``VERIFICATION_CODE_RESEND_DELAY`` of the last message,
        nothing is sent at all, which absorbs reloads and extra tabs.

        Callers hold a row lock (``select_for_update``). Two concurrent
        requests would otherwise each mint a code, and only the one written
        last would work.

        Unless ``keep_auth_token`` is set, ``one_time_auth_token`` is cleared:
        once an account is being claimed with a code, that code is the way in,
        and a magic link still lying around must not stand in for it. The
        password reset flow takes the same precaution (see users/forms.py). The
        clearing goes through a queryset update rather than ``save()``:
        ``save()`` mints a replacement token for any ``temporary`` user (see
        below), which would silently undo the precaution for exactly the
        accounts this flow creates.
        """
        now = timezone.now()
        reusable = (
            self.verification_code is not None
            and self.verification_code_issued_at is not None
            and now - self.verification_code_issued_at < VERIFICATION_CODE_REUSE_WINDOW
            and self.verification_attempts < MAX_VERIFICATION_ATTEMPTS
        )
        recently_sent = (
            self.verification_code_sent_at is not None
            and now - self.verification_code_sent_at < VERIFICATION_CODE_RESEND_DELAY
        )
        send = not (reusable and recently_sent)
        if not reusable:
            self.verification_code = generate_verification_code()
            self.verification_code_issued_at = now
            self.verification_attempts = 0
        if send:
            self.verification_code_sent_at = now
            self.save(
                update_fields=[
                    "verification_code",
                    "verification_code_issued_at",
                    "verification_code_sent_at",
                    "verification_attempts",
                ]
            )
        if not keep_auth_token:
            self.one_time_auth_token = None
            type(self).objects.filter(pk=self.pk).update(one_time_auth_token=None)
        return send

    @property
    def authenticates_without_code(self) -> bool:
        """Whether a magic-link token alone is enough to sign this user in.

        Invited participants (`temporary`) rely on it: the link in their
        invitation is the whole credential, and asking them for a code would
        add a message and a step to every invitation. Accounts no channel can
        reach automatically have no choice either — no code could be delivered
        to them.

        AnonymousTokenAuthView reads it to decide whether a magic link needs a
        code. SendVerificationCodeView never hands that link to anyone, only a
        token that always needs the code, and withholds even that from these
        accounts.
        """
        return self.requires_manual_access or self.temporary

    @property
    def is_claimed(self) -> bool:
        """Whether the owner has made this account their own.

        Practitioners create accounts for the people they invite and type in
        the email and phone number that sign-in codes and links are sent to.
        Until the owner verifies their email, goes through onboarding, sets a
        password or signs in with one, the account is nothing more than that
        contact card and a typo in it can still be corrected. From then on
        those details are the owner's credentials: whoever rewrites them
        receives the next code and signs in as the owner.
        """
        return bool(
            self.email_verified
            or not self.is_first_login
            or self.last_login
            or (self.password and self.has_usable_password())
        )

    @property
    def name(self) -> str:
        if self.first_name or self.last_name:
            if self.email:
                return f"{self.first_name} {self.last_name} ({self.email})"
            return f"{self.first_name} {self.last_name}"
        return self.email or f"User #{self.pk}"

    @property
    def user_tz(self) -> ZoneInfo:
        return ZoneInfo(self.timezone) or ZoneInfo(settings.TIME_ZONE)

    def send_user_notification(self, title, message) -> FirebaseResponseDict:
        # Docs https://fcm-django.readthedocs.io/en/latest/
        """
        Send notification to user over Firebase Cloud Messaging (FCM).

        :param title: notification
        :param message: Notification body
        """

        message = Message(
            notification=FireBaseNotification(title=title, body=message),
        )

        devices = FCMDeviceOverride.objects.filter(user=self)
        return devices.send_message(message)

    @staticmethod
    def normalize_phone_number(value):
        """Canonical (E.164) form of a phone number, e.g. '+33612345678'.

        Keeping a single form per real number is what lets search, SMS sending
        and the unique constraint all agree regardless of how the number was
        typed (e.g. '06 12 34 56 78'). Numbers that cannot be parsed keep the
        legacy separator-free form; see users/phone.py.
        """
        return normalize_phone_number(value)

    def save(self, *args, **kwargs):
        if self.temporary and not self.one_time_auth_token:
            self.one_time_auth_token = str(uuid.uuid4())
            self.verification_code_created_at = timezone.now()
        if not self.email:
            self.email = None
        self.mobile_phone_number = self.normalize_phone_number(
            self.mobile_phone_number
        )

        super().save(*args, **kwargs)

    class Meta:
        ordering = ["first_name", "last_name", "email"]
        constraints = [
            models.UniqueConstraint(
                fields=["external_id"],
                condition=models.Q(external_id__isnull=False),
                name="user_external_id_unique",
            ),
            # The `unique=True` index on email is case-sensitive in PostgreSQL,
            # while every lookup in the application is case-insensitive. Without
            # this, "John@x.org" and "john@x.org" coexist as two accounts and
            # both break authentication (MultipleObjectsReturned). NULL emails
            # are exempt: a unique index never collides on NULL.
            models.UniqueConstraint(
                Lower("email"),
                name="user_email_case_insensitive_unique",
            ),
        ]


class HealthMetric(models.Model):
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="recorded_health_metrics_creator",
    )

    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
    )

    measured_at = models.DateTimeField(help_text="When the measurements were taken")

    measured_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="recorded_health_metrics",
        help_text="Clinician or device user who recorded the measurements (optional)",
    )

    # Source / metadata
    source = models.CharField(
        max_length=100,
        null=True,
        blank=True,
        help_text="Measurement source (manual, device, EHR import, etc.)",
    )
    notes = models.TextField(
        null=True, blank=True, help_text="Free text notes related to this measurement"
    )

    created_at = models.DateTimeField(
        auto_now_add=True, help_text="Record creation timestamp"
    )
    updated_at = models.DateTimeField(auto_now=True, help_text="Last update timestamp")

    class Meta:
        indexes = [
            models.Index(fields=["user", "measured_at"]),
        ]
        ordering = ["-measured_at"]

    def __str__(self):
        return f"{self.user} @ {self.measured_at:%Y-%m-%d %H:%M}"

    acknowledged_at = models.DateTimeField(blank=True, null=True)

class PatientVisibilityGrant(models.Model):
    """Extends a patient's visibility to another organisation, or to a single
    organisation-less practitioner, once confirmed.

    Two kinds of grant, distinguished by `organisation`:
    - Organisation-wide: `organisation` is set. Created when a practitioner
      who belongs to an organisation requests access; every practitioner of
      that organisation gains visibility once confirmed.
    - Personal: `organisation` is left empty. Created when a practitioner who
      belongs to no organisation requests access; only `requested_by`
      themself gains visibility once confirmed, no one else.

    Created with `confirmed_at=None` when a practitioner requests access to a
    hidden patient by exact email/phone match. `_filter_patients` in
    users/views.py only honours grants where `confirmed_at` is set, so the
    patient must click the confirmation link sent to them before the grant
    takes effect (unless `patient_visibility_requires_confirmation` is
    disabled, in which case it is confirmed immediately). Each grant is
    independent: creating one never revokes another.
    """

    patient = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="visibility_grants",
    )
    organisation = models.ForeignKey(
        "users.Organisation",
        on_delete=models.CASCADE,
        related_name="patient_grants",
        null=True,
        blank=True,
    )
    requested_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        related_name="requested_patient_visibility",
    )
    confirmed_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=["patient", "organisation"],
                condition=Q(organisation__isnull=False),
                name="patient_visibility_grant_org_unique",
            ),
            models.UniqueConstraint(
                fields=["patient", "requested_by"],
                condition=Q(organisation__isnull=True),
                name="patient_visibility_grant_personal_unique",
            ),
        ]

    def __str__(self):
        return f"{self.patient} -> {self.organisation or self.requested_by}"

class DAVAppPassword(models.Model):
    """
    App password for CalDAV/CardDAV access.
    Allows users authenticated via OpenID to use DAV protocols
    which require HTTP Basic Auth.
    """

    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="dav_app_passwords",
    )
    token = models.CharField(
        max_length=256,
        unique=True,
        editable=False,
        help_text="Random token used as password in Basic Auth",
    )
    label = models.CharField(
        max_length=100,
        help_text="Human-readable label, e.g. 'iPhone CardDAV'",
    )
    created_at = models.DateTimeField(auto_now_add=True)
    last_used_at = models.DateTimeField(
        null=True,
        blank=True,
        help_text="Last time this token was used to authenticate",
    )
    is_active = models.BooleanField(default=True)

    class Meta:
        verbose_name = _("DAV app password")
        verbose_name_plural = _("DAV app passwords")
        ordering = ["-created_at"]

    def __str__(self):
        return f"{self.user} — {self.label}"

    def save(self, *args, **kwargs):
        if not self.token:
            self.token = secrets.token_urlsafe(48)
        super().save(*args, **kwargs)

    @classmethod
    def authenticate(cls, username: str, password: str):
        """
        Try to authenticate via app password.
        Returns the User if valid, None otherwise.
        """
        try:
            app_pw = cls.objects.select_related("user").get(
                user__email__iexact=username,
                token=password,
                is_active=True,
            )
        except cls.DoesNotExist:
            return None

        app_pw.last_used_at = timezone.now()
        app_pw.save(update_fields=["last_used_at"])
        return app_pw.user