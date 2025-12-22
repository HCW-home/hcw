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


* do virus scan on attachment saving
* have draft status of appointment
* Add dashboard endpoint
* add user id field in participant adding and username is requested and broken
* Error 400 instead of 500 on errors