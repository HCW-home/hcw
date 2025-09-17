from django.db import models
from django.utils.translation import gettext_lazy as _
from django.conf import settings
from django.db.models.signals import post_save
from django.dispatch import receiver
from django.core.exceptions import ValidationError
from django.contrib.postgres.fields import ArrayField
from typing import Dict, Optional, Sequence
import jinja2
from importlib import import_module
from modeltranslation.utils import get_translation_fields
from django.apps import apps
from .abstracts import ModelCeleryAbstract
from .providers import BaseProvider
from factory.django import DjangoModelFactory
# Create your models here.
from . import providers

class CommunicationMethod(models.TextChoices):
    SMS = 'sms', ('SMS')
    EMAIL = 'email', ('Email')
    WHATSAPP = 'whatsapp', ('WhatsApp')
    PUSH = 'push', ('Push Notification')
    MANUAL = 'manual', ('Manual')

class MessagingProvider(models.Model):

    @staticmethod
    def provider_name() -> Sequence[tuple[str, str]]:
        return providers.MAIN_DISPLAY_NAMES

    name = models.CharField(_('name'), choices=provider_name(), max_length=20)
    communication_method = models.CharField(choices=CommunicationMethod.choices)
    
    # Common authentication fields
    api_key = models.CharField(_('API key'), max_length=200, blank=True, null=True)
    auth_token = models.CharField(_('auth token'), max_length=200, blank=True, null=True)
    account_sid = models.CharField(_('account SID'), max_length=100, blank=True, null=True)
    
    # OAuth fields
    client_id = models.CharField(_('client ID'), max_length=200, blank=True, null=True)
    client_secret = models.CharField(_('client secret'), max_length=200, blank=True, null=True)
    
    # OVH specific fields
    application_key = models.CharField(_('application key'), max_length=200, blank=True, null=True)
    application_secret = models.CharField(_('application secret'), max_length=200, blank=True, null=True)
    consumer_key = models.CharField(_('consumer key'), max_length=200, blank=True, null=True)
    service_name = models.CharField(_('service name'), max_length=100, blank=True, null=True)
    
    # Sender/From fields
    from_phone = models.CharField(_('from phone'), max_length=50, blank=True, null=True)
    from_email = models.EmailField(_('from email'), blank=True, null=True)
    sender_id = models.CharField(_('sender ID'), max_length=50, blank=True, null=True)
    
    priority = models.IntegerField(_('priority'), default=0)
    is_active = models.BooleanField(_('is active'), default=True)

    # Prefix filtering
    excluded_prefixes = ArrayField(
        models.CharField(max_length=50),
        blank=True,
        default=list,
        verbose_name=_('excluded prefixes'),
        help_text=_('Phone prefixes that should NOT use this provider. Separate multiple prefixes with commas (e.g. +33, +41, +1)')
    )
    included_prefixes = ArrayField(
        models.CharField(max_length=50),
        blank=True,
        default=list,
        verbose_name=_('included prefixes'),
        help_text=_('Phone prefixes that should use this provider. Separate multiple prefixes with commas (e.g. +33, +41). If empty, all prefixes except excluded ones are allowed')
    )

    def __str__(self):
        return f"{self.priority} - {self.name}"

    def matches_phone_prefix(self, phone_number: str) -> bool:
        """
        Check if a phone number matches this provider's prefix rules.

        Args:
            phone_number: The phone number to check

        Returns:
            bool: True if the phone number can use this provider, False otherwise
        """
        if not phone_number:
            return False

        # Normalize phone number (remove spaces, dashes, etc.)
        normalized_phone = phone_number.replace(' ', '').replace('-', '').replace('(', '').replace(')', '')

        # Check excluded prefixes first
        if self.excluded_prefixes:
            for prefix in self.excluded_prefixes:
                if normalized_phone.startswith(prefix):
                    return False

        # If included prefixes are specified, check if phone matches any of them
        if self.included_prefixes:
            for prefix in self.included_prefixes:
                if normalized_phone.startswith(prefix):
                    return True
            return False  # Phone doesn't match any included prefix

        # If no included prefixes specified, allow all except excluded ones
        return True

    @property
    def module(self):
        return import_module(f"..providers.{self.name}", __name__)

    @property
    def instance(self) -> BaseProvider:
        return self.module.Main(self)

    def clean(self):
        """Validate prefix fields"""
        super().clean()

        def validate_prefix(prefix, field_name):
            # Strip newlines for validation
            clean_prefixes = prefix.replace("\r", '').split("\n")

            for clean_prefix in clean_prefixes:

                if not clean_prefix.startswith('+'):
                    raise ValidationError({
                        field_name: _(
                            'All prefixes must start with "+". Invalid prefix: "{}"').format(clean_prefix)
                    })

                # Check that the prefix contains only + and digits
                if not all(c.isdigit() or c == '+' for c in clean_prefix):
                    raise ValidationError({
                        field_name: _(
                            'Prefixes can only contain "+" and digits. Invalid prefix: "{}"').format(clean_prefix)
                    })

        # Validate excluded_prefixes
        if self.excluded_prefixes:
            for prefix in self.excluded_prefixes:
                validate_prefix(prefix, 'excluded_prefixes')

        # Validate included_prefixes
        if self.included_prefixes:
            for prefix in self.included_prefixes:
                validate_prefix(prefix, 'included_prefixes')

    def save(self, *args, **kwargs):
        self.communication_method = providers.MAIN_CLASSES.get(
            self.name).communication_method

        # Clean whitespace from prefix arrays
        if self.excluded_prefixes:
            self.excluded_prefixes = [prefix.strip() for prefix in self.excluded_prefixes if prefix.strip()]

        if self.included_prefixes:
            self.included_prefixes = [prefix.strip() for prefix in self.included_prefixes if prefix.strip()]

        return super(MessagingProvider, self).save(*args, **kwargs)

    class Meta:
        verbose_name = _('messaging provider')
        verbose_name_plural = _('messaging providers')
        unique_together = ['communication_method', 'priority']


class Template(models.Model):

    def get_model_choices():
        """Get choices for all Django models in the format (app_label.model_name, verbose_name)"""
        choices = []
        for model in apps.get_models():
            app_label = model._meta.app_label
            verbose_name = model._meta.verbose_name.title()
            choice_key = f"{app_label}.{model.__name__}"
            choice_display = f"{verbose_name} ({app_label})"
            choices.append((choice_key, choice_display))

        return sorted(choices, key=lambda x: x[1])
    
    event_type = models.CharField(_('system name'), max_length=100, unique=True, choices=settings.NOTIFICATION_MESSAGES,
                                 help_text=_('Unique identifier for the template'))
    
    template_text = models.TextField(_('template text'), 
                                   help_text=_('Jinja2 template for message content, use {{ obj }} to get object attributes'))
    
    model = models.CharField(max_length=100, choices=get_model_choices, blank=True, null=True, help_text="This model will be required to contruct message.")

    template_subject = models.CharField(_('template subject'), max_length=500, blank=True,
                                      help_text=_('Jinja2 template for message subject'))
    communication_method = ArrayField(
        base_field=models.CharField(max_length=10, choices=CommunicationMethod.choices),
        default=list,
        blank=True,
    )
    is_active = models.BooleanField(_('is active'), default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    @property
    def factory_instance(self) -> Optional[DjangoModelFactory]:
        if self.model:
            app_label, model_name = self.model.split('.', 1)
            factory_module = import_module(f"{app_label}.factories")
            return getattr(factory_module, f"{model_name}Factory")

    class Meta:
        verbose_name = _('template')
        verbose_name_plural = _('templates')

    def __str__(self):
        return f"{self.event_type}"

    def clean(self):
        """Validate Jinja2 template syntax"""
        super().clean()
        env = jinja2.Environment()
        
        # Validate template_text
        try:
            for field_name in get_translation_fields('template_text'):
                env.parse(getattr(self, field_name))
        except jinja2.TemplateSyntaxError as e:
            raise ValidationError({
                field_name: _(
                    'Invalid Jinja2 template syntax: {}').format(str(e))
            })
        
        # # Validate template_subject if not empty
        try:
            for field_name in get_translation_fields('template_subject'):
                env.parse(getattr(self, field_name))
        except jinja2.TemplateSyntaxError as e:
            raise ValidationError({
                field_name: _(
                    'Invalid Jinja2 template syntax: {}').format(str(e))
            })

    def render_from_template(self, obj=None, context: Optional[Dict] = None):
        """
        Render the template using the provided context and object

        Args:
            context (dict): Dictionary containing template variables
            obj: Object instance to validate against the expected model and include in context

        Returns:
            tuple: (rendered_subject, rendered_text)

        Raises:
            jinja2.TemplateError: If template rendering fails
            ValidationError: If object is not an instance of the expected model
        """
        # Validate object if provided and model is specified
        if obj is not None and self.model:
            try:
                app_label, model_name = self.model.split('.', 1)
                expected_model = apps.get_model(app_label, model_name)

                if not isinstance(obj, expected_model):
                    raise ValidationError(
                        f"Object must be an instance of {self.model}, "
                        f"got {obj.__class__.__module__}.{obj.__class__.__name__}"
                    )
            except (ValueError, LookupError) as e:
                raise ValidationError(f"Invalid model specification '{self.model}': {e}")

        # Create context copy and add object
        render_context = context.copy() if context else {}
        if obj is not None:
            render_context['obj'] = obj

        env = jinja2.Environment()

        # Render template text
        text_template = env.from_string(self.template_text)
        rendered_text = text_template.render(render_context)

        # Render template subject
        rendered_subject = ""
        if self.template_subject:
            subject_template = env.from_string(self.template_subject)
            rendered_subject = subject_template.render(render_context)

        return rendered_subject, rendered_text

    def _extract_variable_paths(self, node, parent_is_getattr=False):
        """
        Recursively extract full variable paths from Jinja2 AST nodes

        Args:
            node: Jinja2 AST node
            parent_is_getattr: Boolean to track if parent node is already a Getattr

        Returns:
            list: List of variable paths
        """
        paths = []

        if hasattr(node, '__class__'):
            class_name = node.__class__.__name__

            # Handle simple variable references ({{ variable }})
            if class_name == 'Name' and not parent_is_getattr:
                paths.append(node.name)

            # Handle attribute access ({{ obj.field.subfield }})
            elif class_name == 'Getattr':
                # Build the full path by traversing the chain
                parts = []
                current = node

                while hasattr(current, 'attr'):
                    parts.append(current.attr)
                    current = current.node

                if hasattr(current, 'name'):
                    parts.append(current.name)
                    # Reverse to get proper order
                    full_path = '.'.join(reversed(parts))
                    paths.append(full_path)

                # Don't recurse into the child nodes of Getattr as we've processed the full chain
                return paths

        # Recursively process child nodes
        if hasattr(node, '__iter__') and not isinstance(node, (str, bytes)):
            try:
                for child in node:
                    is_child_of_getattr = hasattr(node, '__class__') and node.__class__.__name__ == 'Getattr'
                    paths.extend(self._extract_variable_paths(child, is_child_of_getattr))
            except (TypeError, AttributeError):
                pass

        # Process attributes that might contain nodes
        if hasattr(node, '__dict__'):
            for attr_name, attr_value in node.__dict__.items():
                if attr_value is not None and attr_value != node and not attr_name.startswith('_'):
                    # Skip 'node' and 'attr' attributes of Getattr to avoid processing parts of the chain
                    if hasattr(node, '__class__') and node.__class__.__name__ == 'Getattr' and attr_name in ['node', 'attr']:
                        continue
                    paths.extend(self._extract_variable_paths(attr_value, parent_is_getattr))

        return paths

    @property
    def template_variables(self):
        """
        Extract all variable paths used in the Jinja2 templates

        Returns:
            list: List of variable paths found in both subject and text templates
                 (e.g., ['participant.appointment.scheduled_at', 'user.name'])
        """
        variables = set()

        try:
            env = jinja2.Environment()

            # Extract variables from template_text
            if self.template_text:
                text_ast = env.parse(self.template_text)
                variables.update(self._extract_variable_paths(text_ast))

            # Extract variables from template_subject
            if self.template_subject:
                subject_ast = env.parse(self.template_subject)
                variables.update(self._extract_variable_paths(subject_ast))

        except jinja2.TemplateSyntaxError:
            # If template has syntax errors, return empty list
            pass

        return sorted(list(variables))


class TemplateValidationStatus(models.TextChoices):
    CREATED = 'created', _('Created')
    PENDING = 'pending', _('Pending')
    VALIDATED = 'validated', _('Validated')
    REJECTED = 'rejected', _('Rejected')
    FAILED = 'failed', _('Failed')
    OUTDATED = 'outdated', _('Outdated')
    UNUSED = 'unsued', _('Unused')


class TemplateValidation(ModelCeleryAbstract):
    external_template_id = models.CharField(
        _('external template ID'),
        max_length=200,
        blank=True,
        help_text=_('External template ID from the messaging provider (populated after validation submission)')
    )
    messaging_provider = models.ForeignKey(
        MessagingProvider,
        on_delete=models.CASCADE,
        verbose_name=_('messaging provider'),
        help_text=_('The messaging provider where the template is validated')
    )
    template = models.ForeignKey(
        Template,
        on_delete=models.CASCADE,
        verbose_name=_('template'),
        help_text=_('The local template that needs validation')
    )
    language_code = models.CharField(
        _('language code'),
        max_length=5,
        help_text=_('Language code for the template validation (e.g., "en", "fr", "de")')
    )
    status = models.CharField(
        _('status'),
        max_length=20,
        choices=TemplateValidationStatus.choices,
        default=TemplateValidationStatus.CREATED,
        help_text=_('Current validation status')
    )

    # Timestamps
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    validated_at = models.DateTimeField(null=True, blank=True, help_text=_('When the template was validated'))

    # Additional validation info
    validation_response = models.JSONField(
        blank=True,
        null=True,
        help_text=_('Response from the messaging provider during validation')
    )

    class Meta:
        verbose_name = _('template validation')
        verbose_name_plural = _('template validations')
        unique_together = ['messaging_provider', 'template', 'language_code']
        ordering = ['-created_at']

    def __str__(self):
        return f"{self.template} [{self.language_code}] - {self.messaging_provider.name} ({self.get_status_display()})"


class MessageStatus(models.TextChoices):
    PENDING = 'pending', 'Pending'
    SENT = 'sent', 'Sent'
    DELIVERED = 'delivered', 'Delivered'
    FAILED = 'failed', 'Failed'
    READ = 'read', 'Read'


class Message(ModelCeleryAbstract):
    # Message content
    content = models.TextField(_('content'))
    subject = models.CharField(_('subject'), max_length=200, blank=True)

    # Message type and provider
    communication_method = models.CharField(
        _('communication method'), choices=CommunicationMethod.choices, max_length=20, default=CommunicationMethod.SMS)
    provider_name = models.CharField(_('provider name'), max_length=50, blank=True)

    # Recipients
    recipient_phone = models.CharField(_('recipient phone'), max_length=50, blank=True)
    recipient_email = models.EmailField(_('recipient email'), blank=True)

    # Status tracking
    status = models.CharField(
        _('status'), choices=MessageStatus.choices, max_length=20, default=MessageStatus.PENDING)
    sent_at = models.DateTimeField(null=True, blank=True)
    delivered_at = models.DateTimeField(null=True, blank=True)
    read_at = models.DateTimeField(null=True, blank=True)
    failed_at = models.DateTimeField(null=True, blank=True)

    # External provider info
    external_message_id = models.CharField(max_length=200, blank=True)
    error_message = models.TextField(blank=True)

    # Sender
    sent_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='sent_messages'
    )

    # Recipient
    sent_to = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='received_messages'
    )

    updated_at = models.DateTimeField(auto_now=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-created_at']

    def __str__(self):
        return f"Message to {self.recipient_phone or self.recipient_email} - {self.status}"

@receiver(post_save, sender=Message)
def queue_message_sending(sender, instance, created, **kwargs):
    """
    Automatically queue message for sending when a new message is created
    """
    if created and instance.status == MessageStatus.PENDING:
        print(f"BIN {instance}")
        # Import here to avoid circular imports
        from .tasks import send_message_via_provider
        
        # Queue the message for sending
        task = send_message_via_provider.delay(instance.id)
        
        # Update message with task ID (without triggering this signal again)
        Message.objects.filter(id=instance.id).update(
            celery_task_id=task.id
        )
