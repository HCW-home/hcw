from allauth.account.utils import setup_user_email
from allauth.socialaccount.models import EmailAddress
from constance import config as constance_config
from consultations.models import Participant
from consultations.serializers import AppointmentDetailSerializer, CustomFieldsMixin
from dj_rest_auth.serializers import PasswordResetSerializer
from django.conf import settings
from django.contrib.auth import authenticate, get_user_model
from django.utils.translation import gettext_lazy as _
from rest_framework import serializers, status
from rest_framework.response import Response

from .forms import CustomAllAuthPasswordResetForm
from .models import HealthMetric, Language, Organisation, Speciality, Term, WebPushSubscription, DAVAppPassword
from .phone import MAX_PHONE_LENGTH, phone_lookup_variants
from .validators import validate_phone_number

UserModel = get_user_model()


class LanguageSerializer(serializers.ModelSerializer):
    class Meta:
        model = Language
        fields = ["id", "name", "code"]


class TermSerializer(serializers.ModelSerializer):
    class Meta:
        model = Term
        fields = ["id", "name", "content", "use_for_patient"]


class OrganisationSerializer(serializers.ModelSerializer):
    class Meta:
        model = Organisation
        fields = [
            "id",
            "name",
            "logo_color",
            "logo_white",
            "favicon",
            "login_text_patient",
            "login_text_practitioner",
            "footer_patient",
            "footer_practitioner",
            "primary_color_patient",
            "primary_color_practitioner",
            "default_term",
            "location",
            "street",
            "city",
            "postal_code",
            "country",
            "phone",
        ]


class SpecialitySerializer(serializers.ModelSerializer):
    class Meta:
        model = Speciality
        fields = ["id", "name", "icon"]


class UserDetailsSerializer(CustomFieldsMixin, serializers.ModelSerializer):
    """
    User model w/o password
    """

    main_organisation = OrganisationSerializer(read_only=True)
    organisations = OrganisationSerializer(many=True, read_only=True)
    languages = LanguageSerializer(many=True, read_only=True)
    specialities = SpecialitySerializer(many=True, read_only=True)
    preferred_language_name = serializers.SerializerMethodField()

    is_online = serializers.BooleanField(read_only=True)
    mobile_phone_number = serializers.CharField(
        allow_null=True,
        allow_blank=True,
        required=False,
        max_length=MAX_PHONE_LENGTH,
        validators=[validate_phone_number],
    )

    languages_ids = serializers.PrimaryKeyRelatedField(
        many=True,
        queryset=Language.objects.all(),
        write_only=True,
        source="languages",
        required=False,
    )
    # encrypted_private_key blob is exposed ONLY to the user themselves so
    # they can decrypt it client-side with their passphrase. Other readers
    # (admins, search results) never see it.
    encrypted_private_key = serializers.SerializerMethodField()

    class Meta:
        model = UserModel
        fields = [
            "pk",
            UserModel.EMAIL_FIELD,
            "picture",
            "first_name",
            "last_name",
            "app_preferences",
            "last_login",
            "communication_method",
            "mobile_phone_number",
            "timezone",
            "location",
            "street",
            "city",
            "postal_code",
            "country",
            "main_organisation",
            "organisations",
            "preferred_language",
            "preferred_language_name",
            "languages_ids",
            "languages",
            "is_online",
            "accepted_term",
            "temporary",
            "is_practitioner",
            "is_first_login",
            "specialities",
            "date_of_birth",
            "gender",
            "public_key",
            "public_key_fingerprint",
            "encrypted_private_key",
            "encryption_passphrase_pending",
            "encryption_key_lost",
        ]
        read_only_fields = [
            "is_practitioner",
            "public_key",
            "public_key_fingerprint",
            "encrypted_private_key",
            "encryption_passphrase_pending",
            "encryption_key_lost",
            "preferred_language_name",
        ]

    def get_encrypted_private_key(self, obj):
        request = self.context.get("request")
        if (
            not request
            or not request.user.is_authenticated
            or request.user.pk != obj.pk
        ):
            return None
        return obj.encrypted_private_key or None

    def get_preferred_language_name(self, obj):
        if obj.preferred_language:
            lang_dict = dict(settings.LANGUAGES)
            return lang_dict.get(obj.preferred_language, obj.preferred_language)
        return None

    def _custom_field_target(self, instance):
        """Custom fields are scoped to the user role: practitioner vs patient."""
        return "users.Practitioner" if instance.is_practitioner else "users.User"

    def to_representation(self, instance):
        ret = super().to_representation(instance)
        ret["custom_fields"] = self._role_custom_fields(instance)
        return ret

    def _role_custom_fields(self, instance):
        """Full list of custom field definitions for the user role, each merged
        with its current value (null when not filled yet)."""
        from django.contrib.contenttypes.models import ContentType
        from consultations.models import CustomField, CustomFieldValue

        target = self._custom_field_target(instance)
        ct = ContentType.objects.get_for_model(instance.__class__)
        values = {
            v.custom_field_id: v.value
            for v in CustomFieldValue.objects.filter(
                content_type=ct,
                object_id=instance.pk,
                custom_field__target_model=target,
            )
        }
        fields = CustomField.objects.filter(target_model=target).order_by(
            "ordering", "name"
        )
        return [
            {
                "field": f.pk,
                "field_name": f.name,
                "field_type": f.field_type,
                "options": f.options,
                "required": f.required,
                "is_public": f.is_public,
                "value": values.get(f.pk),
            }
            for f in fields
        ]

    def _save_custom_fields(self, instance, custom_fields_data):
        """Upsert custom field values, restricted to the fields belonging to the
        user role so a client cannot write values for unrelated targets."""
        if custom_fields_data is None:
            return
        from django.contrib.contenttypes.models import ContentType
        from consultations.models import CustomField, CustomFieldValue

        target = self._custom_field_target(instance)
        ct = ContentType.objects.get_for_model(instance.__class__)
        valid_ids = set(
            CustomField.objects.filter(target_model=target).values_list(
                "id", flat=True
            )
        )
        for item in custom_fields_data:
            if item["field"] not in valid_ids:
                continue
            CustomFieldValue.objects.update_or_create(
                custom_field_id=item["field"],
                content_type=ct,
                object_id=instance.pk,
                defaults={"value": item.get("value")},
            )

    def validate_mobile_phone_number(self, value):
        """Reject a number already taken, comparing canonical forms.

        The field is redeclared above as a plain CharField, which drops the
        UniqueValidator DRF would have derived from `unique=True` — so this is
        the only uniqueness check, and it must also run on creation. It has to
        compare normalised values: the column stores the canonical form, so
        querying the raw input misses the duplicate and the constraint then
        fails at save() time as an unhandled IntegrityError (500 instead of 400).
        """
        if not value:
            return value

        normalized = UserModel.normalize_phone_number(value)
        if not normalized:
            return value

        duplicates = UserModel.objects.filter(
            mobile_phone_number__in=phone_lookup_variants(value)
        )
        if self.instance:
            duplicates = duplicates.exclude(pk=self.instance.pk)

        if duplicates.exists():
            raise serializers.ValidationError(
                _("A user with this phone number already exists.")
            )
        return value

    def update(self, instance, validated_data):
        """Drop the verified flag when the address itself changes.

        Otherwise an account could be moved onto someone else's address and
        stay marked as verified, which the sign-up flow reads as proof that
        this person controls it. Re-verifying is a code away.
        """
        new_email = validated_data.get("email")
        if (
            "email" in validated_data
            and (instance.email or "").lower() != (new_email or "").strip().lower()
        ):
            instance.email_verified = False
        return super().update(instance, validated_data)

    def validate_email(self, value):
        # Uniqueness is checked case-insensitively: the model's unique index is
        # case-sensitive in PostgreSQL but every lookup in the application is
        # not, so two addresses differing only by case would create an account
        # nobody can authenticate with (MultipleObjectsReturned on login).
        if not value:
            return value

        duplicates = UserModel.objects.filter(email__iexact=value.strip())

        if self.instance:
            # Unchanged address (case included): nothing to check.
            if (self.instance.email or "").lower() == value.strip().lower():
                return value
            duplicates = duplicates.exclude(pk=self.instance.pk)

        if duplicates.exists():
            raise serializers.ValidationError(
                "A user with this email already exists."
            )
        return value

    # def validate_temporary(self, value):
    #     if self.instance and not self.instance.temporary and value:
    #         raise serializers.ValidationError(
    #             "A permanent patient cannot be made temporary."
    #         )
    #     return value

    def validate(self, attrs):
        attrs = super().validate(attrs)

        communication_method = attrs.get(
            "communication_method",
            getattr(self.instance, "communication_method", None),
        )
        phone = attrs.get(
            "mobile_phone_number",
            getattr(self.instance, "mobile_phone_number", None),
        )

        if communication_method in ("sms", "whatsapp") and not phone:
            raise serializers.ValidationError(
                {
                    "mobile_phone_number": _(
                        "A phone number is required when communication method is SMS or WhatsApp."
                    )
                }
            )

        email = attrs.get(
            "email",
            getattr(self.instance, "email", None),
        )

        if communication_method == "email" and not email:
            raise serializers.ValidationError(
                {
                    "email": _(
                        "An email is required when communication method is Email."
                    )
                }
            )

        # Force temporary=True on patient creation when the toggle is active.
        # Only applies to creation (self.instance is None); edits leave the
        # existing `temporary` value untouched.
        if self.instance is None and constance_config.force_temporary_patients:
            explicit_temporary = None
            if isinstance(getattr(self, "initial_data", None), dict):
                explicit_temporary = self.initial_data.get("temporary")
            if explicit_temporary is False:
                raise serializers.ValidationError(
                    {
                        "temporary": _(
                            "Patient management is in temporary-only mode; temporary=False is not allowed."
                        )
                    }
                )
            attrs["temporary"] = True

        return attrs


def sms_channel_available():
    """Whether a provider can actually deliver a code by SMS or WhatsApp.

    Without one, a phone-only sign-up would create an account nobody can reach:
    ``messaging.tasks.send_message`` just marks the message failed, and the
    account stays inactive for good.
    """
    from messaging.models import CommunicationMethod, MessagingProvider

    return MessagingProvider.objects.filter(
        is_active=True,
        communication_method__in=[
            CommunicationMethod.sms,
            CommunicationMethod.whatsapp,
        ],
    ).exists()


class RegisterSerializer(serializers.Serializer):
    """Sign-up from a single field: an email address or a phone number.

    Neither name nor password is collected here. The account is claimed by
    typing back the code we send, and the profile is filled in during
    onboarding — where a password is only offered when the instance actually
    allows patients to sign in with one.
    """

    identifier = serializers.CharField()

    def validate_identifier(self, value):
        from .identifier import PHONE, resolve_identifier

        kind, normalized = resolve_identifier(value)
        if kind == PHONE and not sms_channel_available():
            raise serializers.ValidationError(
                _("This instance cannot send text messages. Use an email address.")
            )
        return normalized

    def save(self, request):
        from messaging.models import CommunicationMethod

        from .identifier import EMAIL, resolve_identifier

        kind, value = resolve_identifier(self.validated_data["identifier"])

        # An account already using this identifier is returned as-is, without
        # a word: answering differently would turn sign-up into a way to test
        # whether someone is a patient here. The caller sends a fresh code
        # either way, so a legitimate owner simply reclaims their account.
        if kind == EMAIL:
            user, created = UserModel.objects.get_or_create_by_email(
                value,
                defaults={
                    "is_active": False,
                    "communication_method": CommunicationMethod.email,
                },
            )
        else:
            user, created = UserModel.objects.get_or_create_by_phone(
                value,
                defaults={
                    "is_active": False,
                    # Prefer SMS: no WhatsApp content is mapped for this
                    # template, so that channel would fail over to SMS anyway
                    # after a wasted round-trip.
                    "communication_method": CommunicationMethod.sms,
                },
            )

        if created:
            user.set_unusable_password()
            user.save(update_fields=["password"])
            if kind == EMAIL:
                setup_user_email(request, user, [])

        return user


class LoginSerializer(serializers.Serializer):
    """
    Custom login serializer that uses email instead of username
    """

    email = serializers.EmailField(required=True)
    password = serializers.CharField(style={"input_type": "password"}, write_only=True)

    def validate(self, attrs):
        email = attrs.get("email")
        password = attrs.get("password")

        if email and password:
            user = authenticate(
                request=self.context.get("request"), username=email, password=password
            )

            if not user:
                msg = "Unable to log in with provided credentials."
                raise serializers.ValidationError(msg, code="authorization")
        else:
            msg = 'Must include "email" and "password".'
            raise serializers.ValidationError(msg, code="authorization")

        attrs["user"] = user
        return attrs


class UserSerializer(serializers.ModelSerializer):
    specialities = SpecialitySerializer(many=True, read_only=True)

    class Meta:
        model = UserModel
        fields = ["id", "email", "first_name", "last_name", "specialities"]


class HealthMetricSerializer(CustomFieldsMixin, serializers.ModelSerializer):
    user = UserSerializer(read_only=True)
    created_by = UserSerializer(read_only=True)
    measured_by = UserSerializer(read_only=True)

    class Meta:
        model = HealthMetric
        fields = [
            "id",
            "user",
            "created_by",
            "measured_by",
            "measured_at",
            "source",
            "notes",
            "created_at",
            "updated_at",
        ]
        read_only_fields = [
            "id",
            "user",
            "created_by",
            "measured_by",
            "created_at",
            "updated_at",
        ]


class WebPushSubscriptionSerializer(serializers.ModelSerializer):
    class Meta:
        model = WebPushSubscription
        fields = ["id", "endpoint", "p256dh", "auth", "browser"]

    def create(self, validated_data):
        user = self.context["request"].user
        subscription, _ = WebPushSubscription.objects.update_or_create(
            user=user,
            endpoint=validated_data["endpoint"],
            defaults={
                "p256dh": validated_data["p256dh"],
                "auth": validated_data["auth"],
                "browser": validated_data.get("browser", ""),
                "is_active": True,
            },
        )
        return subscription


class CustomPasswordResetSerializer(PasswordResetSerializer):
    @property
    def password_reset_form_class(self):
        return CustomAllAuthPasswordResetForm


class UserParticipantDetailSerializer(serializers.ModelSerializer):
    appointment = AppointmentDetailSerializer(read_only=True)

    class Meta:
        model = Participant
        fields = [
            "is_confirmed",
            "appointment",
            "status",
        ]
        read_only_field = [
            "status",
            "appointment",
        ]

class DAVAppPasswordSerializer(serializers.ModelSerializer):
    token = serializers.CharField(read_only=True)

    class Meta:
        model = DAVAppPassword
        fields = [
            "id",
            "label",
            "token",
            "created_at",
            "last_used_at",
            "is_active"
        ]
        read_only_fields = [
            "id",
            "token",
            "created_at",
            "last_used_at"
        ]

class PublicPractitionerSerializer(serializers.ModelSerializer):
    """
    Read-only serializer exposing only public practitioner data for the map.
    """

    specialities = SpecialitySerializer(many=True, read_only=True)
    main_organisation = OrganisationSerializer(read_only=True)
    public_custom_fields = serializers.SerializerMethodField()

    class Meta:
        model = UserModel
        fields = [
            "pk",
            "first_name",
            "last_name",
            "email",
            "mobile_phone_number",
            "picture",
            "job_title",
            "specialities",
            "main_organisation",
            "location",
            "street",
            "city",
            "postal_code",
            "country",
            "public_custom_fields",
        ]
        read_only_fields = fields

    def get_public_custom_fields(self, obj):
        from consultations.models import CustomFieldValue
        from consultations.serializers import CustomFieldValueReadSerializer
        from django.contrib.contenttypes.models import ContentType

        ct = ContentType.objects.get_for_model(obj.__class__)
        values = CustomFieldValue.objects.filter(
            content_type=ct,
            object_id=obj.pk,
            custom_field__is_public=True,
            custom_field__target_model__in=["users.User", "users.Practitioner"],
        ).select_related("custom_field")
        return CustomFieldValueReadSerializer(values, many=True).data
