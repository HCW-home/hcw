from django.utils.translation import gettext as _
from django.conf import settings

DEFAULT_NOTIFICATION_MESSAGES = {
    "appointment_first_reminder": {
        "template_subject": _(
            "Your appointment planned {{ obj.appointment.scheduled_at|date }}"
        ),
        "template_content": _(
            "This is a reminder for your appointment scheduled for {{ obj.appointment.scheduled_at|date }} at {{ obj.appointment.scheduled_at|time }}."
        ),
        "template_content_html": _(
            "<p>This is a reminder for your appointment scheduled for <strong>{{ obj.appointment.scheduled_at|date }}</strong> at <strong>{{ obj.appointment.scheduled_at|time }}</strong>.</p>"
        ),
        "model": "consultations.Participant",
        "helper_text": "Message sent to participant when a beneficiary sends a message",
    },
    "appointment_last_reminder": {
        "template_subject": _(
            "Your appointment will start in {{config.last_appointment_reminder}}"
        ),
        "template_content": _(
            """Your consultation appointment start at {{ obj.appointment.scheduled_at|time }}\n"""
        ),
        "template_content_html": _(
            """<p>Your consultation appointment start at <strong>{{ obj.appointment.scheduled_at|time }}</strong></p>"""
        ),
        "action": "join",
        "action_label": _("Click here to join consultation"),
        "model": "consultations.Participant",
        "helper_text": "Message sent to participant when a beneficiary sends a message",
    },
    "invitation_to_appointment": {
        "template_subject": _("Your consultation has been scheduled"),
        "template_content": _(
            """Hello,\n"""
            """Your consultation has been successfully scheduled. \n"""
            """Appointment is scheduled for {{ obj.appointment.scheduled_at|date }} at {{ obj.appointment.scheduled_at|time }} ({{ obj.appointment.scheduled_at }})\n"""
            """Please confirm your presence: {{access_link}}"""
        ),
        "template_content_html": _(
            """<p>Hello,</p>"""
            """<p>Your consultation has been successfully scheduled.</p>"""
            """<p>Appointment is scheduled for <strong>{{ obj.appointment.scheduled_at|date }}</strong> at <strong>{{ obj.appointment.scheduled_at|time }}</strong> ({{ obj.appointment.scheduled_at }})</p>"""
        ),
        "action": "presence",
        "action_label": _("Click here to confirm your presence"),
        "model": "consultations.Participant",
        "helper_text": "Message sent to participant with invitation to join a consultation at a later time",
    },
    "appointment_cancelled": {
        "template_subject": _("Your appointment has been cancelled"),
        "template_content": _("Your appointment scheduled at"),
        "template_content_html": _("<p>Your appointment scheduled at</p>"),
        "model": "consultations.Participant",
        "helper_text": "Message sent to participant when appointment is cancelled",
    },
    "appointment_updated": {
        "template_subject": _("Your appointment has been updated"),
        "template_content": _(
            """Your appointment previously scheduled for {{ obj.appointment.previous_scheduled_at|date }} """
            """at {{ obj.appointment.previous_scheduled_at|time }} is now scheduled for """
            """{{ obj.appointment.scheduled_at|date }} at {{ obj.appointment.scheduled_at|time }}"""
        ),
        "template_content_html": _(
            """<p>Your appointment previously scheduled for <strong>{{ obj.appointment.previous_scheduled_at|date }}</strong> """
            """at <strong>{{ obj.appointment.previous_scheduled_at|time }}</strong> is now scheduled for """
            """<strong>{{ obj.appointment.scheduled_at|date }}</strong> at <strong>{{ obj.appointment.scheduled_at|time }}</strong></p>"""
        ),
        "model": "consultations.Participant",
        "helper_text": "Message sent to participant when appointment date and time is updated",
    },
    "your_authentication_code": {
        "template_subject": _("Your confirmation code"),
        "template_content": _(
            "To continue your login process, please use your the confirmation code: {{ obj.verification_code }}"
        ),
        "template_content_html": _(
            "<p>To continue your login process, please use your the confirmation code: <strong>{{ obj.verification_code }}</strong></p>"
        ),
        "model": "users.User",
        "helper_text": "Message sent to participant containing their authentication code",
    },
    "new_message_notification": {
        "template_subject": _("New message in consultation"),
        "template_content": _(
            "You have received a new message from {{ obj.message.created_by.name }} "
            "in consultation #{{ obj.message.consultation.pk }}: "
            "{{ obj.message.content }}"
        ),
        "template_content_html": _(
            "<p>You have received a new message from <strong>{{ obj.message.created_by.name }}</strong> "
            "in consultation #{{ obj.message.consultation.pk }}:</p>"
            "<p>{{ obj.message.content }}</p>"
        ),
        "model": "consultations.Message",
        "helper_text": "Notification sent when a new message is posted in a consultation",
    },
    "reset_password": {
        "template_subject": _("Reset your password"),
        "template_content": _(
            "You requested a password change, delete this email if it was not requested by email."
        ),
        "template_content_html": _(
            "<p>You requested a password change, delete this email if it was not requested by email."
        ),
        "model": "consultations.Message",
        "helper_text": "Notification sent user request to change password",
        "action": "reset",
        "action_label": _("Click here to reset your password"),
    },
}


NOTIFICATION_CHOICES = [
    (key, v["helper_text"]) for key, v in DEFAULT_NOTIFICATION_MESSAGES.items()
]

