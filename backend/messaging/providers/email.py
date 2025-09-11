from django.core.mail import send_mail, BadHeaderError
from django.conf import settings
from typing import Dict, Any
from .base import BaseProvider
from ..models import Message, CommunicationMethod
import logging


class EmailProvider(BaseProvider):
    """
    Email provider implementation using Django's email backend
    
    This provider uses Django's configured email settings
    """
    
    def validate_configuration(self) -> Dict[str, Any]:
        """
        Validate email configuration
        """
        errors = []
        
        # Check Django email settings
        if not hasattr(settings, 'EMAIL_HOST') or not settings.EMAIL_HOST:
            errors.append("EMAIL_HOST setting is required")
        
        if not hasattr(settings, 'DEFAULT_FROM_EMAIL') or not settings.DEFAULT_FROM_EMAIL:
            errors.append("DEFAULT_FROM_EMAIL setting is required")
            
        return {
            "valid": len(errors) == 0,
            "errors": errors
        }
    
    def send(self, message: Message) -> Dict[str, Any]:
        """
        Send message via Django's email backend
        
        Args:
            message (Message): Message to send
            
        Returns:
            Dict[str, Any]: Result with success status and external_id or error
        """
        if message.communication_method != CommunicationMethod.EMAIL:
            return {
                "success": False,
                "error": f"EmailProvider only supports Email, got {message.communication_method}"
            }
        try:
            self.logger.info(f"Sending email to {message.recipient_email}")
            
            # Validate configuration
            validation = self.validate_configuration()
            if not validation["valid"]:
                return {
                    "success": False,
                    "error": f"Configuration error: {', '.join(validation['errors'])}"
                }
            
            # Validate recipient email
            if not message.recipient_email:
                return {
                    "success": False,
                    "error": "Recipient email address is required"
                }
            
            # Determine sender email
            from_email = self.provider.source_phone or settings.DEFAULT_FROM_EMAIL
            
            # Prepare email data
            subject = message.subject or "Message from HCW"
            message_content = message.content
            recipient_list = [message.recipient_email]
            
            try:
                # Send the email
                send_mail(
                    subject=subject,
                    message=message_content,
                    from_email=from_email,
                    recipient_list=recipient_list,
                    fail_silently=False
                )
                
                external_id = f"email_{message.id}"
                
                self.logger.info(
                    f"Email sent successfully to {message.recipient_email}. External ID: {external_id}"
                )
                
                return {
                    "success": True,
                    "external_id": external_id
                }
                
            except BadHeaderError:
                error_msg = "Invalid header found in email"
                self.logger.error(error_msg)
                return {"success": False, "error": error_msg}
                
            except Exception as e:
                error_msg = f"Error sending email: {str(e)}"
                self.logger.error(error_msg, exc_info=True)
                return {"success": False, "error": error_msg}
                
        except Exception as e:
            error_msg = f"Unexpected error sending email: {str(e)}"
            self.logger.error(error_msg, exc_info=True)
            return {"success": False, "error": error_msg}
    
    
    def get_delivery_status(self, external_id: str) -> Dict[str, Any]:
        """
        Get delivery status for email
        
        Note: Django's email backend doesn't provide delivery tracking,
        so we assume sent emails are delivered
        
        Args:
            external_id (str): Email message ID
            
        Returns:
            Dict[str, Any]: Status information
        """
        # For basic email sending via Django, we can't track delivery status
        # In a production system, you might integrate with services like
        # SendGrid, Mailgun, or AWS SES that provide delivery tracking
        
        if external_id.startswith("email_"):
            return {
                "status": "sent",  # We can only confirm it was sent, not delivered
                "note": "Email delivery tracking not available with Django's basic email backend"
            }
        else:
            return {
                "status": "unknown",
                "error": "Invalid email message ID format"
            }
    
    def test_connection(self) -> Dict[str, Any]:
        """
        Test email configuration
        
        Returns:
            Dict[str, Any]: Connection test result
        """
        validation = self.validate_configuration()
        if not validation["valid"]:
            return {
                "success": False,
                "error": f"Configuration errors: {', '.join(validation['errors'])}"
            }
        
        try:
            from django.core.mail import get_connection
            
            # Test the email connection
            connection = get_connection()
            connection.open()
            connection.close()
            
            return {"success": True}
            
        except Exception as e:
            return {
                "success": False,
                "error": f"Email connection test failed: {str(e)}"
            }
    
    def send_html_email(self, message: Message, html_content: str = None) -> Dict[str, Any]:
        """
        Send HTML email using Django's EmailMultiAlternatives
        
        Args:
            message (Message): Message to send
            html_content (str, optional): HTML version of the email content
            
        Returns:
            Dict[str, Any]: Result with success status and external_id or error
        """
        try:
            from django.core.mail import EmailMultiAlternatives
            
            self.logger.info(f"Sending HTML email to {message.recipient_email}")
            
            # Validate configuration
            validation = self.validate_configuration()
            if not validation["valid"]:
                return {
                    "success": False,
                    "error": f"Configuration error: {', '.join(validation['errors'])}"
                }
            
            # Validate recipient email
            if not message.recipient_email:
                return {
                    "success": False,
                    "error": "Recipient email address is required"
                }
            
            # Determine sender email
            from_email = self.provider.source_phone or settings.DEFAULT_FROM_EMAIL
            
            # Prepare email data
            subject = message.subject or "Message from HCW"
            text_content = message.content
            recipient_list = [message.recipient_email]
            
            # Create email message
            email = EmailMultiAlternatives(
                subject=subject,
                body=text_content,
                from_email=from_email,
                to=recipient_list
            )
            
            # Add HTML content if provided
            if html_content:
                email.attach_alternative(html_content, "text/html")
            
            try:
                # Send the email
                email.send()
                
                external_id = f"html_email_{message.id}"
                
                self.logger.info(
                    f"HTML email sent successfully to {message.recipient_email}. External ID: {external_id}"
                )
                
                return {
                    "success": True,
                    "external_id": external_id
                }
                
            except Exception as e:
                error_msg = f"Error sending HTML email: {str(e)}"
                self.logger.error(error_msg, exc_info=True)
                return {"success": False, "error": error_msg}
                
        except Exception as e:
            error_msg = f"Unexpected error sending HTML email: {str(e)}"
            self.logger.error(error_msg, exc_info=True)
            return {"success": False, "error": error_msg}