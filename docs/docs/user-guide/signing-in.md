# Signing In

## Open the platform

Open the practitioner portal in your browser, at the address provided by your
organisation — for example `https://consult.example.org/`.

HCW@Home is a web application: nothing to install. It works in any recent
browser (Chrome, Edge, Firefox, Safari), on a computer, a tablet or a phone.

## Sign in with your email and password

1. Enter your **Email**
2. Enter your **Password**
3. Click **Sign In**

If your organisation uses single sign-on, click **Login with &lt;provider&gt;**
instead and authenticate with your usual corporate account. Your identity
provider may then ask for a verification code — that step is handled by your
organisation, not by HCW@Home.

!!! note "SSO-only instances"
    When your administrator has disabled password login, the email/password form
    is hidden and you are redirected straight to the SSO provider.

## Forgotten password

1. Click **Forgot Password?** on the sign-in page
2. Enter your email address and click **Reset Password**
3. Open the message you receive and follow the link
4. Choose a new password — at least 8 characters, with one capital, one
   lowercase and one special character

## First sign-in

The first time you connect, the platform asks you for a few things:

1. **Terms & Conditions** — tick *I have read and accept the terms and
   conditions*, then **Accept and continue**.
2. **Preferences** — your preferred communication method (email, SMS,
   WhatsApp…), your timezone and your language. The communication method is how
   the platform notifies you when you are not connected.
3. **Getting started tour** — a short guided wizard walks you through creating
   your first follow-up. You can skip it, and replay it at any time from the
   question-mark button in the header.

## Encrypted instances

If your organisation has enabled end-to-end encryption, you are also asked for
your **encryption passphrase**, sent to you by email when encryption was
activated. It unlocks your private key in this browser so messages can be
decrypted.

You have to do this once per browser. Until the key is loaded, chats display a
*Chat unavailable* notice. You can load, purge or change the passphrase at any
time from **My Profile > Encryption**.

!!! warning
    Nobody can recover your passphrase for you. If you lose it, generate a new
    one from the profile page and ask a colleague to resync your access —
    messages encrypted under the previous key stay unreadable until then.
