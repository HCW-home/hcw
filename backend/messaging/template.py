from django.utils.translation import gettext as _

DEFAULT_NOTIFICATION_MESSAGES = {
    "you_have_been_assigned_to_consultation": {
        "subject": _("You have been assigned to a new consultation"),
        "content": _(
            "You receive this message because you have been assigned to a new consultation. Please log in to the system to view the details and take necessary actions."
        ),
        "model": "consultations.Consultation",
        "helper_text": "Message sent to user when assigned to a consultation",
    },
    "an_unprocessed_request_has_been_received": {
        "subject": _("New consultation request requires your attention"),
        "content": _(
            "You receive this message because a new consultation request has been received that requires your attention. Please log in to the system to review and process the request."
        ),
        "model": "consultations.Requests",
        "helper_text": "Message sent to user when a consultation request requires manual processing",
    },
    "a_message_has_been_sent_by_beneficiary": {
        "subject": _("Message sent to user when a beneficiary sends a message"),
        "content": _(
            "You receive this message because a beneficiary has sent you a new message. Please log in to the system to read and respond to the message."
        ),
        "model": "consultations.Consultation",
        "helper_text": "Message sent to user when a beneficiary sends a message",
    },
    "invitation_to_appointment": {
        "subject": _("Your consultation has been scheduled"),
        "content": _(
            """Hello,\n"""
            """Your consultation has been successfully scheduled. \n"""
            """Appointment scheduled by: {{ obj.appointment.scheduled_at|date }} at {{ obj.appointment.scheduled_at|time }} ({{ obj.appointment.scheduled_at }})\n"""
            """Please confirm your presence: {{config.patient_base_url}}?auth={{ obj.user.one_time_auth_token }}&action=presence"""
        ),
        "model": "consultations.Participant",
        "helper_text": "Message sent to user with invitation to join a consultation at a later time",
    },
    "your_appointment_is_in_24h": {
        "subject": _("Message sent to user 24 hours before scheduled appointment"),
        "content": _(
            "You receive this message as a reminder that you have an upcoming appointment scheduled for tomorrow. Please log in to the system to view the details and prepare accordingly."
        ),
        "model": "consultations.Participant",
        "helper_text": "Message sent to user 24 hours before scheduled appointment",
    },
    "your_authentication_code_is_participant": {
        "subject": _(
            "Message sent to participant containing their authentication code"
        ),
        "content": _(
            "You receive this message containing your authentication code for accessing the consultation. Please use this code to log in to the system and join the consultation."
        ),
        "model": "consultations.Participant",
        "helper_text": "Message sent to participant containing their authentication code",
    },
}


NOTIFICATION_CHOICES = [
    (key, v["helper_text"]) for key, v in DEFAULT_NOTIFICATION_MESSAGES.items()
]
