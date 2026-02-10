from allauth.account import app_settings
from allauth.account.adapter import get_adapter
from allauth.account.utils import setup_user_email
from allauth.socialaccount.models import EmailAddress
from django.conf import settings
from django.contrib.auth import authenticate, get_user_model
from django.core.exceptions import ValidationError as DjangoValidationError
from rest_framework import serializers, status
from rest_framework.response import Response
from dj_rest_auth.serializers import PasswordResetSerializer
from .models import HealthMetric, Language, Organisation, Speciality, Term
from .forms import CustomAllAuthPasswordResetForm
from consultations.serializers import AppointmentDetailSerializer
from consultations.models import Participant
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
            "logo_large",
            "footer",
            "logo_small",
            "primary_color",
            "default_term",
            "location",
            "street",
            "city",
            "postal_code",
            "country",
        ]


class UserDetailsSerializer(serializers.ModelSerializer):
    """
    User model w/o password
    """

    main_organisation = OrganisationSerializer(read_only=True)
    organisations = OrganisationSerializer(many=True, read_only=True)
    languages = LanguageSerializer(many=True, read_only=True)

    languages_ids = serializers.PrimaryKeyRelatedField(
        many=True,
        queryset=Language.objects.all(),
        write_only=True,
        source="languages",
        required=False,
    )

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
            "main_organisation",
            "organisations",
            "preferred_language",
            "languages_ids",
            "languages",
            "is_online",
            "accepted_term",
        ]
        read_only_fields = ["is_online", "first_name", "last_name", UserModel.EMAIL_FIELD]


class RegisterSerializer(serializers.Serializer):
    email = serializers.EmailField(
        required=app_settings.SIGNUP_FIELDS["email"]["required"]
    )
    password = serializers.CharField(write_only=True)

    def validate_email(self, email):
        email = get_adapter().clean_email(email)
        return email

    def validate_password(self, password):
        return get_adapter().clean_password(password)

    def get_cleaned_data(self):
        return {
            "password": self.validated_data.get("password", ""),
            "email": self.validated_data.get("email", ""),
        }

    def save(self, request):
        adapter = get_adapter()
        user = adapter.new_user(request)
        self.cleaned_data = self.get_cleaned_data()
        user = adapter.save_user(request, user, self, commit=False)
        if "password" in self.cleaned_data:
            try:
                adapter.clean_password(self.cleaned_data["password"], user=user)
            except DjangoValidationError as exc:
                raise serializers.ValidationError(
                    detail=serializers.as_serializer_error(exc)
                )
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
    class Meta:
        model = UserModel
        fields = ["id", "email", "first_name", "last_name"]


class HealthMetricSerializer(serializers.ModelSerializer):
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


class CustomPasswordResetSerializer(PasswordResetSerializer):
    @property
    def password_reset_form_class(self):
        return CustomAllAuthPasswordResetForm


class UserParticipantDetailSerializer(serializers.ModelSerializer):

    appointment = AppointmentDetailSerializer(read_only=True)

    class Meta:
        model = Participant
        fields = [
            'is_confirmed',
            'appointment',
            'status',
        ]
        read_only_field = [
            "status",
            'appointment',
        ]
