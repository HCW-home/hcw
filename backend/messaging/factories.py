import factory
from factory.django import DjangoModelFactory
from django.utils import timezone
from datetime import timedelta

from messaging.models import (
    MessagingProvider, Template, TemplateValidation, Message,
    CommunicationMethod, TemplateValidationStatus, MessageStatus
)


class MessagingProviderFactory(DjangoModelFactory):
    class Meta:
        model = MessagingProvider

    name = factory.Faker('random_element', elements=['twilio_sms', 'twilio_whatsapp', 'sendgrid_email', 'ovh_sms'])
    communication_method = CommunicationMethod.SMS

    # Common authentication fields
    api_key = factory.Faker('uuid4')
    auth_token = factory.Faker('uuid4')
    account_sid = factory.Faker('bothify', text='AC################################')

    # Sender/From fields
    from_phone = factory.Faker('phone_number')
    from_email = factory.Faker('email')
    sender_id = factory.Faker('word')

    priority = factory.Sequence(lambda n: n)
    is_active = True

    excluded_prefixes = factory.LazyFunction(list)
    included_prefixes = factory.LazyFunction(list)


class SMSProviderFactory(MessagingProviderFactory):
    """Factory for SMS messaging providers"""
    communication_method = CommunicationMethod.SMS
    from_phone = factory.Faker('phone_number')


class WhatsAppProviderFactory(MessagingProviderFactory):
    """Factory for WhatsApp messaging providers"""
    communication_method = CommunicationMethod.WHATSAPP
    from_phone = factory.Faker('phone_number')


class EmailProviderFactory(MessagingProviderFactory):
    """Factory for Email messaging providers"""
    communication_method = CommunicationMethod.EMAIL
    from_email = factory.Faker('email')


class TemplateFactory(DjangoModelFactory):
    class Meta:
        model = Template

    system_name = factory.Sequence(lambda n: f"template_{n}")
    name = factory.Faker('sentence', nb_words=3)
    description = factory.Faker('text', max_nb_chars=100)
    template_text = factory.LazyFunction(
        lambda: "Hello {{ object.first_name }}, your appointment is scheduled for {{ object.scheduled_at }}."
    )
    template_subject = factory.LazyFunction(
        lambda: "Appointment Reminder for {{ object.first_name }}"
    )
    model = factory.Faker('random_element', elements=['users.user', 'consultations.appointment', 'consultations.consultation'])
    communication_method = factory.LazyFunction(lambda: [CommunicationMethod.EMAIL])
    is_active = True


class SMSTemplateFactory(TemplateFactory):
    """Factory for SMS templates"""
    communication_method = factory.LazyFunction(lambda: [CommunicationMethod.SMS])
    template_text = factory.LazyFunction(
        lambda: "Hi {{ object.first_name }}, appointment reminder for {{ object.scheduled_at }}. Reply STOP to opt out."
    )
    template_subject = ""


class WhatsAppTemplateFactory(TemplateFactory):
    """Factory for WhatsApp templates"""
    communication_method = factory.LazyFunction(lambda: [CommunicationMethod.WHATSAPP])
    template_text = factory.LazyFunction(
        lambda: "Hello {{ object.first_name }}, your appointment with Dr. {{ object.doctor.last_name }} is scheduled for {{ object.scheduled_at }}."
    )
    template_subject = ""


class EmailTemplateFactory(TemplateFactory):
    """Factory for Email templates"""
    communication_method = factory.LazyFunction(lambda: [CommunicationMethod.EMAIL])
    template_text = factory.LazyFunction(
        lambda: "Dear {{ object.first_name }},\n\nThis is a reminder that your appointment is scheduled for {{ object.scheduled_at }}.\n\nBest regards,\nThe Team"
    )
    template_subject = factory.LazyFunction(
        lambda: "Appointment Reminder - {{ object.scheduled_at|date:'M d, Y' }}"
    )


class TemplateValidationFactory(DjangoModelFactory):
    class Meta:
        model = TemplateValidation

    messaging_provider = factory.SubFactory(MessagingProviderFactory)
    template = factory.SubFactory(TemplateFactory)
    language_code = factory.Faker('random_element', elements=['en', 'fr', 'de', 'es', 'it'])
    status = TemplateValidationStatus.CREATED
    external_template_id = factory.Faker('bothify', text='template_#########')
    validation_response = factory.LazyFunction(
        lambda: {"status": "pending", "submitted_at": timezone.now().isoformat()}
    )


class ValidatedTemplateValidationFactory(TemplateValidationFactory):
    """Factory for validated templates"""
    status = TemplateValidationStatus.VALIDATED
    validated_at = factory.LazyFunction(timezone.now)
    validation_response = factory.LazyFunction(
        lambda: {
            "status": "approved",
            "validated_at": timezone.now().isoformat(),
            "template_id": factory.Faker('bothify', text='template_#########').generate()
        }
    )


class MessageFactory(DjangoModelFactory):
    class Meta:
        model = Message

    content = factory.Faker('text', max_nb_chars=200)
    subject = factory.Faker('sentence', nb_words=6)
    communication_method = CommunicationMethod.SMS
    provider_name = 'twilio_sms'

    # Recipients
    recipient_phone = factory.Faker('phone_number')
    recipient_email = factory.Faker('email')

    status = MessageStatus.PENDING
    external_message_id = factory.Faker('bothify', text='msg_#########')

    # Users
    sent_by = factory.SubFactory('users.tests.factories.UserFactory')
    sent_to = factory.SubFactory('users.tests.factories.UserFactory')


class SMSMessageFactory(MessageFactory):
    """Factory for SMS messages"""
    communication_method = CommunicationMethod.SMS
    provider_name = 'twilio_sms'
    recipient_phone = factory.Faker('phone_number')
    recipient_email = ""
    subject = ""
    content = factory.Faker('text', max_nb_chars=160)


class WhatsAppMessageFactory(MessageFactory):
    """Factory for WhatsApp messages"""
    communication_method = CommunicationMethod.WHATSAPP
    provider_name = 'twilio_whatsapp'
    recipient_phone = factory.Faker('phone_number')
    recipient_email = ""
    subject = ""
    content = factory.Faker('text', max_nb_chars=300)


class EmailMessageFactory(MessageFactory):
    """Factory for Email messages"""
    communication_method = CommunicationMethod.EMAIL
    provider_name = 'sendgrid_email'
    recipient_phone = ""
    recipient_email = factory.Faker('email')
    subject = factory.Faker('sentence', nb_words=6)
    content = factory.Faker('text', max_nb_chars=1000)


class SentMessageFactory(MessageFactory):
    """Factory for messages that have been sent"""
    status = MessageStatus.SENT
    sent_at = factory.LazyFunction(timezone.now)
    external_message_id = factory.Faker('bothify', text='msg_#########')


class DeliveredMessageFactory(SentMessageFactory):
    """Factory for messages that have been delivered"""
    status = MessageStatus.DELIVERED
    delivered_at = factory.LazyFunction(timezone.now)


class FailedMessageFactory(MessageFactory):
    """Factory for messages that failed to send"""
    status = MessageStatus.FAILED
    failed_at = factory.LazyFunction(timezone.now)
    error_message = factory.Faker('sentence', nb_words=8)