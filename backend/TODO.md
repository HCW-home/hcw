* [OK] (only email for now) Magic link login, this should accept phone number or email in body, and just send email or sms to that phone number or email It should navigte to /verification?token=xxxxxxx we need verfy patient access token , which should return current accesss token and create user if user doesn't exists with that emil or phone nuber

* [OK] patient active conultations, patient closed consultation, one api with (type|status) filter
* [OK] / notifications screen
* [OK] settings, where they can configure notification settings
* [OK] book an apointnmen button, where they can create consultation
they can jump to active consultation screen, means consultation room, and messaging, file shareing
update patient user information

* Add language endpoint /language/<lang_code>/
* Add some field in user
* Add location field
* Add terms models
* Add terms for Users



* On sent action appointement, I would track partitipant
* Add message logic and send link and datetime of appointment
* Add calculated status field for participant (participant : sent, read, accepted)
* Add validation on phone number

* Websocket messages
* edit appointment > reset participant notification status

* Add appointment into consultation patient side
* Send join appointment

## Top priority

* Add dashboard endpoint for both doctor and patient
    - Next appointment
    - Up coming appointment
    - Overdue consultation

* New consultation
    1 - Select beneficiary + reason + description
    2 - Owner is either Team or Doctor group or owned_by
    3 - Improve appointment creation
        - handling dont_invite_beneficiary, dont_invite_practitionner and dont_invite_me
        - check there is at least two participants
        - change button "add participant" and having Existing user selected by default
        - remove feedback_rate and feedback_message
        - use timezone, communication_method and preferred_language

* Consultation overview
    - Edit should have modal or inline edit, not back to wizard
    - Merge Edit and Manage participant button and modal, participants can be manage on the right.

## Low priority

* Join consultation : add intermediate page similar to google meet.
* Health Metric : add custom fields on patient + on health metric + endpoints
* Remove delete appointment