from allauth.account import app_settings
from allauth.account.adapter import get_adapter
from allauth.account.utils import setup_user_email
from allauth.socialaccount.models import EmailAddress
from constance import config as constance_config
from consultations.models import Participant
from consultations.serializers import AppointmentDetailSerializer, CustomFieldsMixin
from dj_rest_auth.serializers import PasswordResetSerializer
from django.conf import settings
from django.contrib.auth import authenticate, get_user_model
from django.utils.translation import gettext_lazy as _
from django.core.exceptions import ValidationError as DjangoValidationError
from rest_framework import serializers, status
from rest_framework.response import Response

from .forms import CustomAllAuthPasswordResetForm
from .models import HealthMetric, Language, Organisation, Speciality, Term, WebPushSubscription, DAVAppPassword

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
        fields = ["id", "name"]


class UserDetailsSerializer(CustomFieldsMixin, serializers.ModelSerializer):
    """
    User model w/o password
    """

    main_organisation = OrganisationSerializer(read_only=True)
    organisations = OrganisationSerializer(many=True, read_only=True)
    languages = LanguageSerializer(many=True, read_only=True)
    specialities = SpecialitySerializer(many=True, read_only=True)

    is_online = serializers.BooleanField(read_only=True)
    mobile_phone_number = serializers.CharField(allow_null=True, allow_blank=True, required=False)

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
        if self.instance and value:
            if self.instance.mobile_phone_number != value:
                if UserModel.objects.filter(mobile_phone_number=value).exclude(pk=self.instance.pk).exists():
                    raise serializers.ValidationError(
                        "A user with this phone number already exists."
                    )
        return value

    def validate_email(self, value):
        if self.instance and value:
            # Check if email is being changed and if new email already exists
            if self.instance.email != value:
                if UserModel.objects.filter(email=value).exclude(pk=self.instance.pk).exists():
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


class RegisterSerializer(serializers.Serializer):
    email = serializers.EmailField(
        required=app_settings.SIGNUP_FIELDS["email"]["required"]
    )
    first_name = serializers.CharField(required=False, allow_blank=True)
    last_name = serializers.CharField(required=False, allow_blank=True)
    password1 = serializers.CharField(write_only=True)
    password2 = serializers.CharField(write_only=True)

    def validate_email(self, email):
        email = get_adapter().clean_email(email)
        return email

    def validate(self, attrs):
        if attrs.get("password1") != attrs.get("password2"):
            raise serializers.ValidationError({"password2": "Passwords do not match."})
        return attrs

    def get_cleaned_data(self):
        return {
            "password": self.validated_data.get("password1", ""),
            "email": self.validated_data.get("email", ""),
            "first_name": self.validated_data.get("first_name", ""),
            "last_name": self.validated_data.get("last_name", ""),
        }

    def save(self, request):
        self.cleaned_data = self.get_cleaned_data()
        email = self.cleaned_data.get("email", "")

        # If user already exists, silently return existing user
        # to avoid leaking information about registered emails
        existing_user = UserModel.objects.filter(email=email).first()
        if existing_user:
            return existing_user

        adapter = get_adapter()
        user = adapter.new_user(request)
        user = adapter.save_user(request, user, self, commit=False)
        if "password" in self.cleaned_data:
            try:
                adapter.clean_password(self.cleaned_data["password"], user=user)
            except DjangoValidationError as exc:
                raise serializers.ValidationError(
                    detail=serializers.as_serializer_error(exc)
                )
        user.first_name = self.cleaned_data.get("first_name", "")
        user.last_name = self.cleaned_data.get("last_name", "")
        user.is_active = False
        user.save()
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


class SpecialitySerializer(serializers.ModelSerializer):
    class Meta:
        model = Speciality
        fields = ["id", "name"]


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