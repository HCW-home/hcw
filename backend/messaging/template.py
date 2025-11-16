from django.utils.translation import gettext_lazy as _

DEFAULT_NOTIFICATION_MESSAGES = {
        "you_have_been_assigned_to_consultation": {
            "subject": _('You have been assigned to a new consultation'),
            "body": _('You receive this message because you have been assigned to a new consultation. Please log in to the system to view the details and take necessary actions.')
        },
        "an_unprocessed_request_has_been_received": {
            "subject": _('New consultation request requires your attention'),
            "body": _('You receive this message because a new consultation request has been received that requires your attention. Please log in to the system to review and process the request.')
        },
        "a_message_has_been_sent_by_beneficiary": {
            "subject": _('Message sent to user when a beneficiary sends a message'),
            "body": _('You receive this message because a beneficiary has sent you a new message. Please log in to the system to read and respond to the message.')
        },
        "invitation_to_join_consultation_now": {
            "subject": _('Message sent to user with invitation to join a consultation immediately'),
            "body": _('You receive this message because you have been invited to join a consultation. Please log in to the system to join the consultation now.')
        },
        "invitation_to_join_consultation_later": {
            "subject": _('Message sent to user with invitation to join a consultation at a later time'),
            "body": _('You receive this message because you have been invited to join a consultation at a later time. Please log in to the system to view the details and join the consultation when you are ready.')
        },
        "your_appointment_is_in_24h": {
            "subject": _('Message sent to user 24 hours before scheduled appointment'),
            "body": _('You receive this message as a reminder that you have an upcoming appointment scheduled for tomorrow. Please log in to the system to view the details and prepare accordingly.')
        },
        "your_authentication_code_is_participant": {
            "subject": _('Message sent to participant containing their authentication code'),
            "body": _('You receive this message containing your authentication code for accessing the consultation. Please use this code to log in to the system and join the consultation.')
        },
    }