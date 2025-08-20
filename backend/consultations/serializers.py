from rest_framework import serializers
from django.contrib.auth import get_user_model
from .models import Consultation, Group, Appointment, Participant, Message, MessageType, MessageStatus

User = get_user_model()

class UserSerializer(serializers.ModelSerializer):
    class Meta:
        model = User
        fields = ['id', 'email', 'first_name', 'last_name']

class GroupSerializer(serializers.ModelSerializer):
    users = UserSerializer(many=True, read_only=True)
    
    class Meta:
        model = Group
        fields = ['id', 'name', 'users']

class ParticipantSerializer(serializers.ModelSerializer):
    user = UserSerializer(read_only=True)
    
    class Meta:
        model = Participant
        fields = ['id', 'user', 'token', 'is_invited', 'feedback_rate', 'feedback_message']

class AppointmentSerializer(serializers.ModelSerializer):
    participants = ParticipantSerializer(source='participant_set', many=True, read_only=True)
    
    class Meta:
        model = Appointment
        fields = ['id', 'scheduled_at', 'end_expected_at', 'participants']

class MessageSerializer(serializers.ModelSerializer):
    sent_by = UserSerializer(read_only=True)
    participant = ParticipantSerializer(read_only=True)
    
    class Meta:
        model = Message
        fields = [
            'id', 'content', 'subject', 'message_type', 'provider_name',
            'recipient_phone', 'recipient_email', 'status', 
            'sent_at', 'delivered_at', 'read_at', 'failed_at',
            'external_message_id', 'error_message', 'sent_by', 'participant',
            'celery_task_id', 'task_logs', 'task_traceback',
            'created_at', 'updated_at'
        ]
        read_only_fields = [
            'id', 'status', 'sent_at', 'delivered_at', 'read_at', 'failed_at',
            'external_message_id', 'error_message', 'sent_by', 'celery_task_id',
            'task_logs', 'task_traceback', 'created_at', 'updated_at'
        ]

class MessageCreateSerializer(serializers.ModelSerializer):
    participant_id = serializers.IntegerField(required=False, allow_null=True)
    
    class Meta:
        model = Message
        fields = [
            'content', 'subject', 'message_type', 'provider_name',
            'recipient_phone', 'recipient_email', 'participant_id'
        ]
    
    def validate(self, data):
        message_type = data.get('message_type')
        
        # Validate recipient based on message type
        if message_type == MessageType.EMAIL:
            if not data.get('recipient_email'):
                raise serializers.ValidationError("Email address is required for email messages")
        else:  # SMS or WhatsApp
            if not data.get('recipient_phone'):
                raise serializers.ValidationError("Phone number is required for SMS/WhatsApp messages")
        
        return data

class ConsultationSerializer(serializers.ModelSerializer):
    created_by = UserSerializer(read_only=True)
    owned_by = UserSerializer(read_only=True)
    beneficiary = UserSerializer(read_only=True)
    group = GroupSerializer(read_only=True)
    appointments = AppointmentSerializer(source='appointment_set', many=True, read_only=True)
    messages = MessageSerializer(many=True, read_only=True)
    
    # Write-only fields for creating/updating
    group_id = serializers.IntegerField(write_only=True, required=False, allow_null=True)
    beneficiary_id = serializers.IntegerField(write_only=True, required=False, allow_null=True)
    
    class Meta:
        model = Consultation
        fields = [
            'id', 'created_at', 'updated_at', 'closed_at',
            'beneficiary', 'beneficiary_id', 'created_by', 'owned_by', 
            'group', 'group_id', 'appointments', 'messages'
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

# Old MessageSerializer removed - replaced with enhanced version above