from django.utils.translation import gettext_lazy as _

from .models import CommunicationMethod

DEFAULT_NOTIFICATION_MESSAGES = {
    "you_have_been_assigned_to_consultation": {
        "subject": _("You have been assigned to a new consultation"),
        "text": _(
            "You receive this message because you have been assigned to a new consultation. Please log in to the system to view the details and take necessary actions."
        ),
        "model": "consultations.Consultation",
    },
    "an_unprocessed_request_has_been_received": {
        "subject": _("New consultation request requires your attention"),
        "text": _(
            "You receive this message because a new consultation request has been received that requires your attention. Please log in to the system to review and process the request."
        ),
        "model": "consultations.Requests",
    },
    "a_message_has_been_sent_by_beneficiary": {
        "subject": _("Message sent to user when a beneficiary sends a message"),
        "text": _(
            "You receive this message because a beneficiary has sent you a new message. Please log in to the system to read and respond to the message."
        ),
        "model": "consultations.Consultation",
    },
    "invitation_to_appointment": {
        "subject": _(
            "Message sent to user with invitation to join a consultation at a later time"
        ),
        "text": _(
            "You receive this message because you have been invited to join a consultation at a later time. Please log in to the system to view the details and join the consultation when you are ready."
        ),
        "model": "consultations.Participant",
    },
    "your_appointment_is_in_24h": {
        "subject": _("Message sent to user 24 hours before scheduled appointment"),
        "text": _(
            "You receive this message as a reminder that you have an upcoming appointment scheduled for tomorrow. Please log in to the system to view the details and prepare accordingly."
        ),
        "model": "consultations.Participant",
    },
    "your_authentication_code_is_participant": {
        "subject": _(
            "Message sent to participant containing their authentication code"
        ),
        "text": _(
            "You receive this message containing your authentication code for accessing the consultation. Please use this code to log in to the system and join the consultation."
        ),
        "model": "consultations.Participant",
    },
}
