from django.contrib.auth import get_user_model
from drf_spectacular.utils import extend_schema_field
from rest_framework import serializers

from .models import (
    Appointment,
    BookingSlot,
    Consultation,
    Message,
    Participant,
    Queue,
    Reason,
    Request,
)

User = get_user_model()


class ConsultationUserSerializer(serializers.ModelSerializer):
    class Meta:
        model = User
        fields = ["id", "email", "first_name", "last_name", "is_online"]


class QueueSerializer(serializers.ModelSerializer):
    users = ConsultationUserSerializer(many=True, read_only=True)

    class Meta:
        model = Queue
        fields = ["id", "name", "users"]


class ParticipantSerializer(serializers.ModelSerializer):
    user = ConsultationUserSerializer(read_only=True)
    user_id = serializers.IntegerField(write_only=True, required=False, allow_null=True)

    class Meta:
        model = Participant
        fields = [
            "id",
            "user",
            "user_id",
            "is_invited",
            "is_confirmed",
            "email",
            "phone",
            "timezone",
            "first_name",
            "last_name",
            "feedback_rate",
            "feedback_message",
        ]

    def validate(self, attrs):
        """Validate that the participant doesn't already exist for this appointment."""
        # Get appointment from context (set when creating participant)
        appointment = self.context.get("appointment") or attrs.get("appointment")

        if appointment:
            # Check if user_id is provided
            user_id = attrs.get("user_id")
            if user_id:
                try:
                    existing_user = User.objects.get(id=user_id)
                    if Participant.objects.filter(
                        appointment=appointment, user=existing_user
                    ).exists():
                        raise serializers.ValidationError(
                            {
                                "user_id": "A participant with this user already exists for this appointment."
                            }
                        )
                except User.DoesNotExist:
                    raise serializers.ValidationError({"user_id": "User not found."})

            # Check if email is provided
            email = attrs.get("email")
            phone = attrs.get("phone")

            if email:
                # Check if a participant with this email already exists for this appointment
                # The email will be used to create/get a user in the model's save method
                existing_user = User.objects.filter(email=email).first()
                if existing_user:
                    # Check if this user is already a participant in this appointment
                    if Participant.objects.filter(
                        appointment=appointment, user=existing_user
                    ).exists():
                        raise serializers.ValidationError(
                            {
                                "email": "A participant with this email already exists for this appointment."
                            }
                        )

            elif phone and not email:
                # Check if a participant with this phone already exists
                existing_user = User.objects.filter(mobile_phone_number=phone).first()
                if existing_user:
                    if Participant.objects.filter(
                        appointment=appointment, user=existing_user
                    ).exists():
                        raise serializers.ValidationError(
                            {
                                "phone": "A participant with this phone number already exists for this appointment."
                            }
                        )

        return attrs

    def create(self, validated_data):
        user_id = validated_data.pop("user_id", None)
        if user_id:
            validated_data["user"] = User.objects.get(id=user_id)
        return super().create(validated_data)


class AppointmentSerializer(serializers.ModelSerializer):
    created_by = ConsultationUserSerializer(default=serializers.CurrentUserDefault())
    consultation = serializers.PrimaryKeyRelatedField(read_only=True)
    participants = ParticipantSerializer(many=True, read_only=True)

    class Meta:
        model = Appointment
        fields = [
            "id",
            "scheduled_at",
            "end_expected_at",
            "type",
            "consultation",
            "created_by",
            "status",
            "created_at",
            "participants",
        ]
        read_only_fields = ["id", "status"]


class AttachmentMetadataSerializer(serializers.Serializer):
    file_name = serializers.CharField()
    mime_type = serializers.CharField()


class ConsultationMessageSerializer(serializers.ModelSerializer):
    created_by = ConsultationUserSerializer(default=serializers.CurrentUserDefault())
    # consultation = serializers.PrimaryKeyRelatedField(read_only=True)
    attachment = serializers.SerializerMethodField()

    class Meta:
        model = Message
        fields = [
            "id",
            "content",
            "attachment",
            "created_at",
            "created_by",
            "deleted_at",
        ]

    @extend_schema_field(AttachmentMetadataSerializer(allow_null=True))
    def get_attachment(self, obj):
        """Return attachment metadata if attachment exists."""
        if obj.attachment:
            import mimetypes
            import os

            file_name = os.path.basename(obj.attachment.name)
            mime_type = (
                mimetypes.guess_type(obj.attachment.name)[0]
                or "application/octet-stream"
            )

            return {"file_name": file_name, "mime_type": mime_type}
        return None


class ConsultationMessageCreateSerializer(ConsultationMessageSerializer):
    attachment = serializers.FileField(required=False, allow_null=True)

    class Meta:
        model = Message
        fields = [
            "id",
            "content",
            "attachment",
            "created_at",
            "created_by",
            "deleted_at",
        ]


class ConsultationSerializer(serializers.ModelSerializer):
    created_by = ConsultationUserSerializer(read_only=True)
    owned_by = ConsultationUserSerializer(read_only=True)
    beneficiary = ConsultationUserSerializer(read_only=True)
    group = QueueSerializer(read_only=True)

    # Write-only fields for creating/updating
    group_id = serializers.IntegerField(
        write_only=True, required=False, allow_null=True
    )
    beneficiary_id = serializers.IntegerField(
        write_only=True, required=False, allow_null=True
    )

    class Meta:
        model = Consultation
        fields = [
            "id",
            "created_at",
            "updated_at",
            "beneficiary",
            "beneficiary_id",
            "created_by",
            "owned_by",
            "group",
            "group_id",
            "description",
            "title",
        ]
        read_only_fields = [
            "id",
            "created_at",
            "updated_at",
            "created_by",
            "owned_by",
            "closed_at",
        ]

    def create(self, validated_data):
        # Remove write-only fields from validated_data
        group_id = validated_data.pop("group_id", None)
        beneficiary_id = validated_data.pop("beneficiary_id", None)

        # Set the user creating the consultation
        user = self.context["request"].user
        validated_data["created_by"] = user
        validated_data["owned_by"] = user

        # Set group and beneficiary if provided
        if group_id:
            try:
                group = Queue.objects.get(id=group_id)
                # Verify user has access to this group
                if user in group.users.all():
                    validated_data["group"] = group
            except Queue.DoesNotExist:
                pass

        if beneficiary_id:
            try:
                beneficiary = User.objects.get(id=beneficiary_id)
                validated_data["beneficiary"] = beneficiary
            except User.DoesNotExist:
                pass

        return super().create(validated_data)


class ConsultationCreateSerializer(serializers.ModelSerializer):
    class Meta:
        model = Consultation
        fields = ["id", "group", "beneficiary", "description", "title"]
        read_only_fields = ["id"]


class ReasonSerializer(serializers.ModelSerializer):
    class Meta:
        model = Reason
        fields = ["id", "name", "duration", "queue_assignee", "user_assignee"]


class BookingSlotSerializer(serializers.ModelSerializer):
    user = ConsultationUserSerializer(read_only=True)

    class Meta:
        model = BookingSlot
        fields = [
            "id",
            "user",
            "start_time",
            "end_time",
            "start_break",
            "end_break",
            "monday",
            "tuesday",
            "wednesday",
            "thursday",
            "friday",
            "saturday",
            "sunday",
            "valid_until",
        ]
        read_only_fields = ["id", "user", "created_by"]

    def create(self, validated_data):
        request_user = self.context["request"].user
        validated_data["user"] = request_user
        validated_data["created_by"] = request_user
        return super().create(validated_data)


class AppointmentDetailSerializer(serializers.ModelSerializer):
    created_by = ConsultationUserSerializer(read_only=True)
    consultation = ConsultationSerializer(read_only=True)
    participants = ParticipantSerializer(many=True, read_only=True)

    class Meta:
        model = Appointment
        fields = [
            "id",
            "scheduled_at",
            "end_expected_at",
            "type",
            "consultation",
            "created_by",
            "status",
            "created_at",
            "participants",
        ]


class RequestSerializer(serializers.ModelSerializer):
    created_by = ConsultationUserSerializer(read_only=True)
    expected_with = ConsultationUserSerializer(read_only=True)
    consultation = ConsultationSerializer(read_only=True)
    appointment = AppointmentSerializer(read_only=True)
    reason = ReasonSerializer(read_only=True)
    reason_id = serializers.IntegerField(write_only=True)
    expected_with_id = serializers.IntegerField(
        write_only=True, required=False, allow_null=True
    )

    class Meta:
        model = Request
        fields = [
            "id",
            "expected_at",
            "expected_with",
            "expected_with_id",
            "reason",
            "reason_id",
            "created_by",
            "comment",
            "status",
            "refused_reason",
            "appointment",
            "consultation",
        ]
        read_only_fields = ["id", "created_by", "status"]

    def create(self, validated_data):
        reason_id = validated_data.pop("reason_id")
        expected_with_id = validated_data.pop("expected_with_id", None)

        try:
            reason = Reason.objects.get(id=reason_id, is_active=True)
            validated_data["reason"] = reason
        except Reason.DoesNotExist:
            raise serializers.ValidationError(
                "This reason does not exist or is not active."
            )

        if expected_with_id:
            try:
                expected_with = User.objects.get(id=expected_with_id)
                validated_data["expected_with"] = expected_with
            except User.DoesNotExist:
                raise serializers.ValidationError(
                    "The specified doctor does not exist."
                )

        user = self.context["request"].user
        validated_data["created_by"] = user

        return super().create(validated_data)
