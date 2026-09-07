# Your Profile and Preferences

Click your name in the upper right corner, then **My Profile**.

## Profile

### Personal Information

First name, last name and email address are managed by your administrator and
cannot be changed here.

### Contact Information

- **Mobile Phone**
- **Preferred Communication** — how the platform reaches you when you are not
  connected: Email, SMS, WhatsApp, Push Notification, Manual Contact or None

### Preferences

- **Timezone** — every date and time in the interface is displayed in this
  timezone
- **Preferred Language** — the language of the interface, of your emails and of
  your notifications
- **Languages that you can speak** — visible to colleagues, useful when someone
  looks for a practitioner who speaks a patient's language

### Professional Information

Your **Specialities**, used when patients request a consultation by specialty.

Click **Save Changes** to apply.

!!! note "Changing the interface language"
    **Preferred Language** drives the whole application: the interface, your
    emails and your notifications. The change takes effect as soon as you save.

## System Test

The **System Test** tab checks your equipment outside of any consultation:
camera preview, microphone level, speaker playback and connection to the video
server. Run it before an important consultation, or when a participant reports a
problem.

## Synchronization

The **Synchronization** tab connects your calendar application to HCW@Home over
CalDAV/CardDAV: your appointments show up in Thunderbird, Apple Calendar, an
iPhone, and so on.

1. Note the **DAV URLs** and your **Login**
2. Give the application a name — *iPhone*, *Thunderbird* — and click **New
   Password**
3. Copy the generated password into your calendar application **immediately**:
   it is shown once and never again

Each application gets its own password, revocable independently with **Revoke**,
without touching your account password. The list shows when each one was last
used.

## Encryption

On instances with end-to-end encryption, an **Encryption** section at the bottom
of the Profile tab manages the private key held by this browser:

- **Load my key** — enter your passphrase to unlock messages in this browser.
  Needed once per browser or device.
- **Purge my local key** — remove the key from this browser. Do it on a shared
  or borrowed computer.
- **Change passphrase** — enter the current passphrase and the new one

If the section reads *Key not loaded in this browser*, chats stay locked until
you load the key.
