from rest_framework import serializers
from django.contrib.auth import get_user_model
from .models import Consultation, Group, Appointment, Participant, Message, Reason, Request, BookingSlot

User = get_user_model()

class ConsultationUserSerializer(serializers.ModelSerializer):
    class Meta:
        model = User
        fields = ['id', 'email', 'first_name', 'last_name']

class GroupSerializer(serializers.ModelSerializer):
    users = ConsultationUserSerializer(many=True, read_only=True)
    
    class Meta:
        model = Group
        fields = ['id', 'name', 'users']

class ParticipantSerializer(serializers.ModelSerializer):
    user = ConsultationUserSerializer(read_only=True)
    
    class Meta:
        model = Participant
        fields = ['id', 'user', 'is_invited', 'is_confirmed', 'email', 'phone', 'feedback_rate', 'feedback_message']

class AppointmentSerializer(serializers.ModelSerializer):
    created_by = serializers.HiddenField(
        default=serializers.CurrentUserDefault())
    consultation = serializers.PrimaryKeyRelatedField(read_only=True)
    participants = ParticipantSerializer(source='participant_set', many=True, read_only=True)
    
    class Meta:
        model = Appointment
        fields = ['id', 'scheduled_at', 'end_expected_at',
                  'consultation', 'created_by', 'status', 'created_at', 'participants']
        read_only_fields = ['id', 'status']

class ConsultationMessageSerializer(serializers.ModelSerializer):
    created_by = serializers.HiddenField(
        default=serializers.CurrentUserDefault())
    consultation = serializers.PrimaryKeyRelatedField(read_only=True)
    
    class Meta:
        model = Message
        fields = ['id', 'content', 'attachment', 'created_at', 'created_by', 'consultation']

class ConsultationSerializer(serializers.ModelSerializer):
    created_by = ConsultationUserSerializer(read_only=True)
    owned_by = ConsultationUserSerializer(read_only=True)
    beneficiary = ConsultationUserSerializer(read_only=True)
    group = GroupSerializer(read_only=True)
    
    # Write-only fields for creating/updating
    group_id = serializers.IntegerField(write_only=True, required=False, allow_null=True)
    beneficiary_id = serializers.IntegerField(write_only=True, required=False, allow_null=True)
    
    class Meta:
        model = Consultation
        fields = [
            'id', 'created_at', 'updated_at', 'closed_at',
            'beneficiary', 'beneficiary_id', 'created_by', 'owned_by', 
            'group', 'group_id', 'description', 'title'
        ]
        read_only_fields = ['id', 'created_at', 'updated_at', 'created_by', 'owned_by']

    def create(self, validated_data):
        # Remove write-only fields from validated_data
        group_id = validated_data.pop('group_id', None)
        beneficiary_id = validated_data.pop('beneficiary_id', None)
        
        # Set the user creating the consultation
        user = self.context['request'].user
        validated_data['created_by'] = user
        validated_data['owned_by'] = user
        
        # Set group and beneficiary if provided
        if group_id:
            try:
                group = Group.objects.get(id=group_id)
                # Verify user has access to this group
                if user in group.users.all():
                    validated_data['group'] = group
            except Group.DoesNotExist:
                pass
                
        if beneficiary_id:
            try:
                beneficiary = User.objects.get(id=beneficiary_id)
                validated_data['beneficiary'] = beneficiary
            except User.DoesNotExist:
                pass
        
        return super().create(validated_data)

class ConsultationCreateSerializer(serializers.ModelSerializer):
    group_id = serializers.IntegerField(required=False, allow_null=True)
    beneficiary_id = serializers.IntegerField(required=False, allow_null=True)
    
    class Meta:
        model = Consultation
        fields = ['group_id', 'beneficiary_id', 'closed_at']

    def validate_group_id(self, value):
        if value is not None:
            user = self.context['request'].user
            try:
                group = Group.objects.get(id=value)
                if user not in group.users.all():
                    raise serializers.ValidationError("You don't have access to this group.")
            except Group.DoesNotExist:
                raise serializers.ValidationError("This group does not exist.")
        return value

    def validate_beneficiary_id(self, value):
        if value is not None:
            try:
                User.objects.get(id=value)
            except User.DoesNotExist:
                raise serializers.ValidationError("This user does not exist.")
        return value

class ReasonSerializer(serializers.ModelSerializer):
    class Meta:
        model = Reason
        fields = ['id', 'name', 'duration', 'group_assignee', 'user_assignee']

class RequestSerializer(serializers.ModelSerializer):
    created_by = ConsultationUserSerializer(read_only=True)
    expected_with = ConsultationUserSerializer(read_only=True)
    reason = ReasonSerializer(read_only=True)
    reason_id = serializers.IntegerField(write_only=True)
    expected_with_id = serializers.IntegerField(write_only=True, required=False, allow_null=True)
    
    class Meta:
        model = Request
        fields = [
            'id', 'expected_at', 'expected_with', 'expected_with_id', 
            'reason', 'reason_id', 'created_by', 'comment', 'status'
        ]
        read_only_fields = ['id', 'created_by', 'status']

    def create(self, validated_data):
        reason_id = validated_data.pop('reason_id')
        expected_with_id = validated_data.pop('expected_with_id', None)
        
        try:
            reason = Reason.objects.get(id=reason_id, is_active=True)
            validated_data['reason'] = reason
        except Reason.DoesNotExist:
            raise serializers.ValidationError("This reason does not exist or is not active.")
        
        if expected_with_id:
            try:
                expected_with = User.objects.get(id=expected_with_id)
                validated_data['expected_with'] = expected_with
            except User.DoesNotExist:
                raise serializers.ValidationError("The specified doctor does not exist.")
        
        user = self.context['request'].user
        validated_data['created_by'] = user
        
        return super().create(validated_data)

class BookingSlotSerializer(serializers.ModelSerializer):
    user = ConsultationUserSerializer(read_only=True)
    
    class Meta:
        model = BookingSlot
        fields = [
            'id', 'user', 'start_time', 'end_time', 'start_break', 'end_break',
            'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday',
            'valid_until'
        ]
        read_only_fields = ['id', 'user', 'created_by']
        
    def create(self, validated_data):
        request_user = self.context['request'].user
        validated_data['user'] = request_user
        validated_data['created_by'] = request_user
        return super().create(validated_data)