from django.contrib.auth import get_user_model
from rest_framework import serializers

from .models import Message

User = get_user_model()


class MessageSenderSerializer(serializers.ModelSerializer):
    class Meta:
        model = User
        fields = ["id", "email", "first_name", "last_name"]


class MessageSerializer(serializers.ModelSerializer):
    sent_by = MessageSenderSerializer(read_only=True)
    content = serializers.SerializerMethodField()
    subject = serializers.SerializerMethodField()

    class Meta:
        model = Message
        fields = [
            "id",
            "content",
            "subject",
            "communication_method",
            "status",
            "sent_at",
            "delivered_at",
            "read_at",
            "failed_at",
            "sent_by",
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["id", "created_at", "updated_at", "sent_by"]

    def get_content(self, obj):
        """Get rendered content from the model property."""
        return obj.render_content

    def get_subject(self, obj):
        """Get rendered subject from the model property."""
        return obj.render_subject
