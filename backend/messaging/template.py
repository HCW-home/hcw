from django.utils.translation import gettext as _
from django.conf import settings

DEFAULT_NOTIFICATION_MESSAGES = {
    # "you_have_been_assigned_to_consultation": {
    #     "subject": _("You have been assigned to a new consultation"),
    #     "content": _(
    #         "You receive this message because you have been assigned to a new consultation. Please log in to the system to view the details and take necessary actions."
    #     ),
    #     "model": "consultations.Consultation",
    #     "helper_text": "Message sent to participant when assigned to a consultation",
    # },
    "appointment_first_reminder": {
        "subject": _(
            "Your appointment planned {{ obj.appointment.scheduled_at|date }}"
        ),
        "content": _(
            "This is a reminder for your appointment scheduled for {{ obj.appointment.scheduled_at|date }} at {{ obj.appointment.scheduled_at|time }}."
        ),
        "model": "consultations.Participant",
        "helper_text": "Message sent to participant when a beneficiary sends a message",
    },
    "appointment_last_reminder": {
        "subject": _(
            "Your appointment will start in {{config.last_appointment_reminder}}"
        ),
        "content": _(
            """Your consultation appointment start at {{ obj.appointment.scheduled_at|time }}\n"""
            """Please join immediately with the link: {{config.patient_base_url}}?auth={{ obj.user.one_time_auth_token }}&action=join"""
        ),
        "action": "join",
        "model": "consultations.Participant",
        "helper_text": "Message sent to participant when a beneficiary sends a message",
    },
    "invitation_to_appointment": {
        "subject": _("Your consultation has been scheduled"),
        "content": _(
            """Hello,\n"""
            """Your consultation has been successfully scheduled. \n"""
            """Appointment is scheduled for {{ obj.appointment.scheduled_at|date }} at {{ obj.appointment.scheduled_at|time }} ({{ obj.appointment.scheduled_at }})\n"""
            """Please confirm your presence: {{config.patient_base_url}}?auth={{ obj.user.one_time_auth_token }}&action=presence"""
        ),
        "action": "presence",
        "model": "consultations.Participant",
        "helper_text": "Message sent to participant with invitation to join a consultation at a later time",
    },
    "appointment_cancelled": {
        "subject": _("Your appointment has been cancelled"),
        "content": _("Your appointment scheduled at"),
        "model": "consultations.Participant",
        "helper_text": "Message sent to participant when appointment is cancelled",
    },
    "appointment_updated": {
        "subject": _("Your appointment has been updated"),
        "content": _(
            """Your appointment previously scheduled for {{ obj.appointment.previous_scheduled_at|date }} """
            """at {{ obj.appointment.previous_scheduled_at|time }} is now scheduled for """
            """{{ obj.appointment.scheduled_at|date }} at {{ obj.appointment.scheduled_at|time }}"""
        ),
        "model": "consultations.Participant",
        "helper_text": "Message sent to participant when appointment date and time is updated",
    },
    "your_authentication_code": {
        "subject": _("Your confirmation code"),
        "content": _(
            "To continue your login process, please use your the confirmation code: {{ obj.verification_code }}"
        ),
        "model": "users.User",
        "helper_text": "Message sent to participant containing their authentication code",
    },
    "new_message_notification": {
        "subject": _("New message in consultation"),
        "content": _(
            "You have received a new message from {{ obj.message.created_by.name }} "
            "in consultation #{{ obj.message.consultation.pk }}: "
            "{{ obj.message.content|truncatewords:20 }}"
        ),
        "model": "consultations.Message",
        "helper_text": "Notification sent when a new message is posted in a consultation",
    },
}


NOTIFICATION_CHOICES = [
    (key, v["helper_text"]) for key, v in DEFAULT_NOTIFICATION_MESSAGES.items()
]
