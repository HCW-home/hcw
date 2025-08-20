import logging
import traceback
import io
from celery import shared_task
from django.utils import timezone
from .models import Message, MessageStatus
from .services import MessagingService

# Set up logging
logger = logging.getLogger(__name__)

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

@shared_task(bind=True, max_retries=3, default_retry_delay=300)
def send_message_task(self, message_id):
    """
    Celery task to send a message asynchronously
    
    Args:
        message_id (int): ID of the message to send
    
    Returns:
        dict: Result of the sending operation
    """
    task_id = self.request.id
    
    with TaskLogCapture() as log_capture:
        try:
            logger.info(f"Starting message sending task {task_id} for message {message_id}")
            
            # Get the message
            try:
                message = Message.objects.get(id=message_id)
            except Message.DoesNotExist:
                error_msg = f"Message with ID {message_id} not found"
                logger.error(error_msg)
                return {"success": False, "error": error_msg}
            
            # Update message with task info
            message.celery_task_id = task_id
            message.save()
            
            logger.info(f"Processing message: {message.message_type} to {message.recipient_phone or message.recipient_email}")
            
            # Send the message using the messaging service
            result = MessagingService.send_message(message)
            
            # Capture logs
            logs = log_capture.get_logs()
            message.task_logs = logs
            
            if result.get("success"):
                logger.info(f"Message {message_id} sent successfully. External ID: {result.get('external_id')}")
                message.save()
                return {
                    "success": True,
                    "message_id": message_id,
                    "external_id": result.get("external_id"),
                    "task_id": task_id
                }
            else:
                error_msg = result.get("error", "Unknown error occurred")
                logger.error(f"Failed to send message {message_id}: {error_msg}")
                
                # Update message with error info
                message.task_logs = logs
                message.save()
                
                # Retry if we haven't exceeded max retries
                if self.request.retries < self.max_retries:
                    logger.info(f"Retrying message {message_id} in {self.default_retry_delay} seconds (attempt {self.request.retries + 1}/{self.max_retries})")
                    raise self.retry(countdown=self.default_retry_delay)
                
                return {
                    "success": False,
                    "message_id": message_id,
                    "error": error_msg,
                    "task_id": task_id,
                    "retries_exhausted": True
                }
                
        except Exception as exc:
            # Capture exception details
            error_msg = str(exc)
            tb = traceback.format_exc()
            logs = log_capture.get_logs()
            
            logger.error(f"Exception in send_message_task for message {message_id}: {error_msg}")
            logger.error(f"Traceback: {tb}")
            
            # Update message with error info
            try:
                message = Message.objects.get(id=message_id)
                message.celery_task_id = task_id
                message.task_logs = logs
                message.task_traceback = tb
                
                # Mark as failed if we've exhausted retries
                if self.request.retries >= self.max_retries:
                    message.mark_as_failed(f"Task failed after {self.max_retries} retries: {error_msg}")
                
                message.save()
            except Exception as save_exc:
                logger.error(f"Failed to update message {message_id} with error info: {save_exc}")
            
            # Retry if we haven't exceeded max retries
            if self.request.retries < self.max_retries:
                logger.info(f"Retrying message {message_id} due to exception in {self.default_retry_delay} seconds")
                raise self.retry(countdown=self.default_retry_delay, exc=exc)
            
            # All retries exhausted
            return {
                "success": False,
                "message_id": message_id,
                "error": error_msg,
                "traceback": tb,
                "task_id": task_id,
                "retries_exhausted": True
            }

@shared_task
def resend_failed_messages():
    """
    Periodic task to retry failed messages
    
    This task can be run periodically to retry messages that failed to send
    """
    logger.info("Starting resend_failed_messages task")
    
    # Get failed messages from the last 24 hours
    from datetime import timedelta
    cutoff_time = timezone.now() - timedelta(hours=24)
    
    failed_messages = Message.objects.filter(
        status=MessageStatus.FAILED,
        created_at__gte=cutoff_time,
        celery_task_id__isnull=False  # Only messages that were processed by Celery
    )
    
    resent_count = 0
    for message in failed_messages:
        try:
            # Reset message status
            message.status = MessageStatus.PENDING
            message.error_message = ''
            message.task_traceback = ''
            message.save()
            
            # Queue the message for sending
            task = send_message_task.delay(message.id)
            message.celery_task_id = task.id
            message.save()
            
            resent_count += 1
            logger.info(f"Queued message {message.id} for resending with task {task.id}")
            
        except Exception as e:
            logger.error(f"Failed to queue message {message.id} for resending: {e}")
    
    logger.info(f"Resend task completed. Queued {resent_count} messages for resending")
    return {"resent_count": resent_count}

@shared_task
def cleanup_old_message_logs():
    """
    Periodic task to clean up old message logs to prevent database bloat
    
    Removes logs older than 30 days
    """
    logger.info("Starting cleanup_old_message_logs task")
    
    from datetime import timedelta
    cutoff_time = timezone.now() - timedelta(days=30)
    
    # Clear logs from old messages
    updated_count = Message.objects.filter(
        created_at__lt=cutoff_time
    ).update(
        task_logs='',
        task_traceback=''
    )
    
    logger.info(f"Cleaned up logs from {updated_count} old messages")
    return {"cleaned_count": updated_count}