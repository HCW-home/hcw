import logging
import traceback
import io
from celery import shared_task
from django.utils import timezone
from .models import Message, MessageStatus, MessagingProvider, Template, TemplateValidation, TemplateValidationStatus
from . import providers
from modeltranslation.utils import get_translation_fields
from django.conf import settings
from django.core.exceptions import ObjectDoesNotExist

# Set up logging
logger = logging.getLogger(__name__)

@shared_task(bind=True)
def send_message_via_provider(self, message_id):
    """
    Celery task to send message by trying providers in priority order
    
    Args:
        message_id (int): The ID of the message to send
    """
    try:
        # Get the message
        message = Message.objects.get(id=message_id)
    except Message.DoesNotExist:
        error_msg = f"Message with ID {message_id} not found"
        logger.error(error_msg)
        return {"success": False, "error": error_msg}
    
    # Update message with task info
    message.celery_task_id = self.request.id
    message.save()
    
    # Get all active providers for this communication method, ordered by priority
    messaging_providers = MessagingProvider.objects.filter(
        communication_method=message.communication_method,
        is_active=True
    ).order_by('priority', 'id')
    
    if not messaging_providers.exists():
        message.status = MessageStatus.FAILED
        raise ObjectDoesNotExist(
            f"No active providers found for communication method: {message.communication_method}")
    
    logger.info(f"Found {messaging_providers.count()} providers for {message.communication_method}")
    
    # Try each provider in order
    for messaging_provider in messaging_providers:
        logger.info(f"Trying provider: {messaging_provider.name} (priority: {messaging_provider.priority})")
        
        try:
            # Get the provider class
            messaging_provider.instance.send(message)
            message.status = MessageStatus.SENT
            message.save()
                
        except Exception as e:
            message.task_logs += f"Exception with provider {messaging_provider.name}: {str(e)}"
            message.save()
            logger.error(error_msg)
            logger.error(traceback.format_exc())
            continue
    
    # All providers failed
    message.task_logs = f"All providers failed for communication method: {message.communication_method}"
    message.status = MessageStatus.FAILED
    message.save()

class TaskLogCapture:
    """Context manager to capture logs during task execution"""
    
    def __init__(self):
        self.log_capture = io.StringIO()
        self.handler = logging.StreamHandler(self.log_capture)
        self.handler.setLevel(logging.INFO)
        formatter = logging.Formatter('%(asctime)s - %(name)s - %(levelname)s - %(message)s')
        self.handler.setFormatter(formatter)
    
    def __enter__(self):
        # Add handler to capture logs
        logger.addHandler(self.handler)
        return self
    
    def __exit__(self, exc_type, exc_val, exc_tb):
        # Remove handler and get logs
        logger.removeHandler(self.handler)
        self.handler.close()
    
    def get_logs(self):
        return self.log_capture.getvalue()

@shared_task
def cleanup_old_message_logs(days=30):
    """
    Periodic task to clean up old message logs to prevent database bloat
    
    Removes logs older than 30 days
    """
    logger.info("Starting cleanup_old_message_logs task")
    
    from datetime import timedelta
    cutoff_time = timezone.now() - timedelta(days=days)
    
    # Clear logs from old messages
    updated_count = Message.objects.filter(
        created_at__lt=cutoff_time
    ).update(
        task_logs='',
        task_traceback=''
    )
    
    logger.info(f"Cleaned up logs from {updated_count} old messages")
    return {"cleaned_count": updated_count}

@shared_task
def create_template_validation(template_id, template_created):
    """
    Create template validations for all available languages and providers that support validation.

    Args:
        template_id (int): The ID of the template
        created (bool): Whether the template was just created
    """

    try:
        template = Template.objects.get(id=template_id)
    except Template.DoesNotExist:
        logger.error(f"Template with ID {template_id} not found")
        return {"success": False, "error": f"Template with ID {template_id} not found"}

    templates = []

    for lang, _ in settings.LANGUAGES:
        if hasattr(template, f"template_text_{lang}"):
            for communication_method in template.communication_method:

                for messaging_provider in MessagingProvider.objects.filter(communication_method=communication_method):
                    
                    provider_module = messaging_provider.module
                    
                    if hasattr(provider_module.Main, "validate_template") and callable(getattr(provider_module.Main, "validate_template", None)):

                        template, created = TemplateValidation.objects.update_or_create(
                            template=template,
                            messaging_provider=messaging_provider,
                            language_code=lang,
                        )

                        if created:
                            template.status = TemplateValidationStatus.PENDING
                            template.save()
                        
                        templates.append(template)


@shared_task(bind=True)
def template_messaging_provider_task(self, template_validation_id, method):
    try:
        template_validation = TemplateValidation.objects.get(
            id=template_validation_id)
    except TemplateValidation.DoesNotExist:  # fixed wrong exception class
        logger.error(
            f"TemplateValidation with ID {template_validation_id} not found")
        return {"success": False, "error": f"TemplateValidation with ID {template_validation_id} not found"}

    template_validation.celery_task_id = self.request.id

    try:
        # Get the provider instance
        provider_instance = template_validation.messaging_provider.instance

        # Dynamically resolve the method name
        func = getattr(provider_instance, method, None)
        if not callable(func):
            raise AttributeError(
                f"Method '{method}' not found on {provider_instance.__class__.__name__}")

        # Call the resolved method
        func(template_validation)

    except Exception as e:
        template_validation.task_logs += f"Unable to run {method} on template {template_validation}: {str(e)}"
        template_validation.status = TemplateValidationStatus.REJECTED
        template_validation.save()
        return

    template_validation.status = TemplateValidationStatus.VALIDATED
    template_validation.save()
