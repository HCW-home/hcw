from django.contrib.auth import get_user_model
from drf_spectacular.utils import extend_schema_field
from rest_framework import serializers
from django.utils.translation import gettext_lazy as _

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
            "status",
            "email",
            "phone",
            "timezone",
            "first_name",
            "last_name",
            "communication_method",
            "preferred_language"
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


class ConsultationSerializer(serializers.ModelSerializer):
    created_by = ConsultationUserSerializer(read_only=True)
    owned_by = ConsultationUserSerializer(read_only=True)
    owned_by_id = serializers.PrimaryKeyRelatedField(
        queryset=User.objects.all(),
        source='owned_by',
        write_only=True,
        required=False,
        allow_null=True
    )
    beneficiary = ConsultationUserSerializer(read_only=True)
    beneficiary_id = serializers.PrimaryKeyRelatedField(
        queryset=User.objects.all(),
        source='beneficiary',
        write_only=True,
        required=False,
        allow_null=True
    )
    group = QueueSerializer(read_only=True)
    group_id = serializers.PrimaryKeyRelatedField(
        queryset=Queue.objects.all(),
        source='group',
        write_only=True,
        required=False,
        allow_null=True
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
            "owned_by_id",
            "group",
            "group_id",
            "description",
            "title",
            "closed_at",
        ]
        read_only_fields = [
            "id",
            "created_at",
            "updated_at",
            "created_by",
            "closed_at",
        ]


class AppointmentSerializer(serializers.ModelSerializer):
    created_by = ConsultationUserSerializer(read_only=True)
    consultation = ConsultationSerializer(read_only=True)
    consultation_id = serializers.IntegerField(write_only=True, required=False, allow_null=True)
    participants = ParticipantSerializer(
        many=True, read_only=False, required=False)
    dont_invite_beneficiary = serializers.BooleanField(required=False)
    dont_invite_practitioner = serializers.BooleanField(required=False)
    dont_invite_me = serializers.BooleanField(required=False)

    class Meta:
        model = Appointment
        fields = [
            "id",
            "scheduled_at",
            "end_expected_at",
            "type",
            "consultation",
            "consultation_id",
            "created_by",
            "status",
            "created_at",
            "participants",
            "dont_invite_beneficiary",
            "dont_invite_practitioner",
            "dont_invite_me",
        ]
        read_only_fields = ["id", "created_by", "created_at"]

    def create(self, validated_data):
        participants_data = validated_data.pop('participants', [])
        consultation_id = validated_data.pop('consultation_id', None)
        dont_invite_beneficiary = validated_data.pop('dont_invite_beneficiary', False)
        dont_invite_practitioner = validated_data.pop('dont_invite_practitioner', False)
        dont_invite_me = validated_data.pop('dont_invite_me', False)

        consultation = None
        if consultation_id:
            try:
                consultation = Consultation.objects.get(id=consultation_id)
                validated_data['consultation'] = consultation
            except Consultation.DoesNotExist:
                raise serializers.ValidationError({"consultation_id": "Consultation not found."})

        user = self.context.get('request').user if self.context.get('request') else None
        if user:
            validated_data['created_by'] = user

        appointment = super().create(validated_data)

        # Track user IDs to avoid duplicates
        added_user_ids = set()

        # Add participants from manual input
        for participant_data in participants_data:
            user_id = participant_data.get('user_id')
            if user_id and user_id in added_user_ids:
                continue

            serializer = ParticipantSerializer(data=participant_data, context={'appointment': appointment})
            serializer.is_valid(raise_exception=True)
            participant = serializer.save(appointment=appointment)

            if participant.user_id:
                added_user_ids.add(participant.user_id)

        # Auto-add participants based on flags
        if consultation:
            # Add practitioner (owned_by)
            if not dont_invite_practitioner and consultation.owned_by_id and consultation.owned_by_id not in added_user_ids:
                Participant.objects.create(
                    appointment=appointment,
                    user=consultation.owned_by
                )
                added_user_ids.add(consultation.owned_by_id)

            # Add beneficiary
            if not dont_invite_beneficiary and consultation.beneficiary_id and consultation.beneficiary_id not in added_user_ids:
                Participant.objects.create(
                    appointment=appointment,
                    user=consultation.beneficiary
                )
                added_user_ids.add(consultation.beneficiary_id)

        # Add request user (created_by)
        if not dont_invite_me and user and user.id not in added_user_ids:
            Participant.objects.create(
                appointment=appointment,
                user=user
            )
            added_user_ids.add(user.id)

        return appointment

    def update(self, instance, validated_data):
        participants_data = validated_data.pop('participants', None)

        instance = super().update(instance, validated_data)

        if participants_data is not None:
            existing_ids = set(
                instance.participants.filter(is_active=True).values_list('id', flat=True))
            incoming_ids = set()

            for participant_data in participants_data:
                participant_id = participant_data.pop('id', None)

                if participant_id and participant_id in existing_ids:
                    participant = instance.participants.get(id=participant_id)
                    serializer = ParticipantSerializer(
                        instance=participant,
                        data=participant_data,
                        partial=True
                    )
                    serializer.is_valid(raise_exception=True)
                    serializer.save()
                    incoming_ids.add(participant_id)
                else:
                    serializer = ParticipantSerializer(data=participant_data)
                    serializer.is_valid(raise_exception=True)
                    incoming_ids.add(serializer.save(appointment=instance).id)

            to_deactivate = existing_ids - incoming_ids
            instance.participants.filter(id__in=to_deactivate).update(is_active=False)

        return instance


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
            "updated_at",
            "created_by",
            "is_edited",
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
            "updated_at",
            "created_by",
            "is_edited",
            "deleted_at",
        ]



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
    participants = ParticipantSerializer(source='active_participants', many=True, read_only=True)

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


# class AppointmentFHIRSerializer(serializers.Serializer):
#     """
#     Serializer that converts Appointment model to FHIR Appointment resource format
#     """

#     def to_representation(self, instance):
#         """Convert Django Appointment to FHIR Appointment resource"""

#         # Map status
#         status_mapping = {
#             "Draft": "pending",
#             "Scheduled": "booked",
#             "Cancelled": "cancelled",
#         }
#         fhir_status = status_mapping.get(instance.status, "pending")

#         # Build FHIR Appointment
#         fhir_appointment = FHIRAppointment(
#             resourceType="Appointment",
#             id=str(instance.id),
#             status=fhir_status,
#             start=instance.scheduled_at.isoformat() if instance.scheduled_at else None,
#             end=instance.end_expected_at.isoformat()
#             if instance.end_expected_at
#             else None,
#             created=instance.created_at.isoformat() if instance.created_at else None,
#         )

#         # Add appointment type
#         if instance.type:
#             appointment_type = CodeableConcept(
#                 coding=[
#                     Coding(
#                         system="http://terminology.hl7.org/CodeSystem/v2-0276",
#                         code="ROUTINE" if instance.type == "Online" else "WALKIN",
#                         display=instance.type,
#                     )
#                 ]
#             )
#             fhir_appointment.appointmentType = appointment_type

#         # Add participants
#         participants = []
#         for participant in instance.participants.all():
#             fhir_participant = {
#                 "actor": {
#                     "reference": f"Patient/{participant.user.id}"
#                     if participant.user
#                     else None,
#                     "display": participant.name
#                     if hasattr(participant, "name")
#                     else participant.email,
#                 },
#                 "status": "accepted" if participant.is_confirmed else "tentative",
#             }
#             participants.append(fhir_participant)

#         if participants:
#             fhir_appointment.participant = participants

#         # Add description from consultation if available
#         if instance.consultation:
#             fhir_appointment.description = (
#                 instance.consultation.description or instance.consultation.title
#             )

#         # Convert to dict for JSON serialization
#         return fhir_appointment.dict(exclude_none=True)
