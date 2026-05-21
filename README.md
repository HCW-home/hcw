# Health Care Worker @Home

HCW@Home V6 is full rewrite of the previous project HCW@Home solution developped Iabsis SARL (Switzerland).

HCW@Home is a scalable, institution-level secure teleconsultation system for typical telemedicine scenarios, achieved through close collaboration with healthcare professionals. It is fully open-source and offers integrated features for chat, audio, and video calls using WebRTC.

### Features

#### Communication & Collaboration

- **Audio & Video Calls** - High-quality WebRTC video conferencing powered by LiveKit
- **Secure Real-time Chat** - End-to-end messaging with file sharing
- **Screen Sharing** - Share your screen during consultations
- **Multi-party Consultations** - Invite colleagues and guests to join consultations
- **Patient Invitations** - Invite patients in seconds via SMS or Email

#### Media & Files

- **Attachment Sharing** - Send and receive images, documents, and files
- **Antivirus Protection** - Integrated ClamAV scanning for uploaded files
- **Session Recording** - Automatic recording of consultations with S3 storage
- **PDF Reports** - Generate consultation reports in PDF format

#### Scheduling & Appointments

- **Appointment Calendar** - Full calendar interface with FullCalendar integration
- **Automated Reminders** - Configurable appointment reminders via push notifications
- **Booking Slots** - Manage availability and booking slots

#### Multi-platform Support

- **Progressive Web App (PWA)** - Installable web application for practitioners
- **Cross-platform** - Works seamlessly on desktop and mobile devices
- **Responsive Design** - All interfaces adapt seamlessly to any screen size

#### Authentication & Security

- **OpenID Connect** - External authentication support (SSO)
- **JWT Authentication** - Secure token-based authentication
- **Multi-factor Authentication** - Enhanced security for user accounts
- **Role-based Access Control** - Simple-grained permissions system

#### Customization & Configuration

- **Multi-language Support** - Available in English, French, Spanish, Italien and German
- **Custom Fields** - Define custom fields for consultations
- **Message Templates** - Pre-defined templates with validation
- **Organizations & Groups** - Multi-organization support with queue management
- **Specialities Management** - Configure medical specialities
- **Dynamic Configuration** - Real-time configuration updates without restart

#### Administration

- **Modern Admin Interface** - Clean, intuitive admin panel powered by Unfold
- **User Management** - Manage users, temporary users, and permissions
- **Translation Overrides** - Customize translations directly from admin
- **Analytics Dashboard** - Monitor system usage and statistics

#### API & Integration

- **RESTful API** - Complete API with OpenAPI/Swagger documentation
- **S3 Storage** - Compatible with AWS S3 and S3-compatible storage

#### Performance & Scalability

- **Redis Caching** - Fast caching layer for improved performance
- **Celery Tasks** - Asynchronous task processing
- **WebSocket Support** - Real-time updates via Django Channels
- **Auto-cleanup** - Automatic deletion of old consultations and temporary users

### Tech Stack

| Category | Technology |
|----------|-----------|
| **Backend** | Django 5.2 + Django REST Framework |
| **ASGI Server** | Daphne + Django Channels |
| **Practitioner Frontend** | Angular 20, FullCalendar |
| **Patient Frontend** | Ionic Angular + Capacitor (iOS/Android) |
| **Video / WebRTC** | LiveKit |
| **Real-time** | Django Channels + WebSockets |
| **Database** | PostgreSQL 15 (multi-tenant via django-tenants) |
| **Cache & Broker** | Redis 7 |
| **Task Queue** | Celery + Celery Beat |
| **Storage** | AWS S3 compatible (django-storages) |
| **Healthcare Interop** | FHIR, CalDAV |
| **Admin Panel** | Django Unfold |
| **PDF Generation** | ReportLab |
| **SMS** | Twilio, OVH, Swisscom, Clickatell |
| **Antivirus** | ClamAV (django-clamd) |
| **Authentication** | JWT, OpenID Connect, MFA |
| **Containerization** | Docker + docker-compose |

### Links

- [Official Website](https://hcw-at-home.com/)

### Licensing

HCW@Home is provided under GPLv3.

### Contribute to translations

A web interface is available at [translate.iabsis.com](https://translate.iabsis.com/) to help with translations without needing to edit files directly.

For developers who prefer working with files directly or need to add new language:

1. Register the language in `backend/core/settings.py` in the `LANGUAGES` tuple. This is required for the language to appear in the `/api/config` endpoint used by the frontends:

```python
LANGUAGES = (
    ("en", gettext("English")),
    ("de", gettext("German")),
    ("fr", gettext("French")),
    ("it", gettext("Italian")),  # new language
)
```

2. Create a new JSON file in both `practitioner/public/i18n/` and `patient/src/assets/i18n/` (e.g., `it.json`), using `en.json` as a template. Put the empty `{}` inside.
3. Register the Angular locale in both `practitioner/src/main.ts` and `patient/src/main.ts`:

```typescript
import localeIt from '@angular/common/locales/it';
registerLocaleData(localeIt);
```

4. Create the backend locale directory and generate the `.po` file:

```bash
cd backend
python3 manage.py makemessages --locale=it --ignore='venv/*'
```

5. Translate all strings and compile with `python3 manage.py compilemessages --ignore='venv/*'`.


### Test data

A fixture file is provided to quickly populate the database with realistic test data:

```bash
cd backend
python3 manage.py loaddata initial/TestData.json
```

This creates:
- 1 organisation (Hôpital Universitaire de Genève)
- 4 practitioners (1 admin, 1 generalist, 1 cardiologist, 1 dermatologist)
- 5 patients (including 1 anonymous/temporary)
- 3 queues (Médecine générale, Cardiologie, Dermatologie)
- 8 consultations with various statuses (open, closed, with/without beneficiary)
- 9 appointments (future, past, cancelled, online and in-person)

All users share the same password: `Test1234`

| Role | Email |
|------|-------|
| Admin | admin@example.com |
| Practitioner | dr.martin@example.com |
| Practitioner | dr.bernard@example.com |
| Practitioner | dr.duval@example.com |
| Patient | jean.dupont@example.com |
| Patient | marie.leclerc@example.com |
| Patient | ahmed.benali@example.com |
| Patient | laura.rossi@example.com |

### Installation

This part will coming soon.

### Running in development

All four processes (Django backend, Celery worker, practitioner frontend, patient frontend) can be launched in a single terminal via [honcho](https://honcho.readthedocs.io) and the `Procfile` at the repo root.

**Prerequisites**

- Python virtualenv at `./venv` with backend dependencies installed (`cd backend && pip install -r requirements.txt`)
- Node modules installed in both `practitioner/` and `patient/` (`npm install` in each)
- A Redis instance reachable (Celery broker + Django Channels) — `redis-server` locally or via Docker

**Start everything**

```bash
make dev
```

**Tenant creation**

```python
tenant_name = 'dev'
tenant = Tenant(schema_name=tenant_name)
tenant.save()

Domain.objects.create(domain=f'127.0.0.1',tenant=tenant)
Domain.objects.create(domain=f'localhost',tenant=tenant)
```

**Default ports**

| Process | URL |
|---------|-----|
| Backend (Django/Daphne) | http://127.0.0.1:8000 |
| Practitioner frontend (`ng serve`) | http://127.0.0.1:4200 |
| Patient frontend (`ng serve`) | http://127.0.0.1:8100 |

### Building the Android app

The patient frontend can be packaged as a native Android app via Capacitor.
The native build expects **Java 21** and Android **compileSdk 35**.

#### One-time prerequisites (Debian/Ubuntu)

Enable the `contrib` component in your apt sources, then:

```bash
sudo apt install \
  openjdk-21-jdk \
  google-android-cmdline-tools-19.0-installer \
  google-android-platform-tools-installer \
  google-android-platform-35-installer \
  google-android-build-tools-34.0.0-installer \
  google-android-licenses
```

This installs the SDK to `/usr/lib/android-sdk/`.

#### One-time project setup

```bash
cd patient/

# Install JS dependencies
yarn install

# Tell Gradle where the SDK lives
echo "sdk.dir=/usr/lib/android-sdk" > android/local.properties

# Force Gradle to use Java 21 (independent of system default)
echo "org.gradle.java.home=/usr/lib/jvm/java-21-openjdk-amd64" >> android/gradle.properties
```

#### Iabsis signing key (required for deeplinks to work)

The native app verifies an Ed25519 signature served by each instance's
`/api/identity/` before trusting it. You must embed the Iabsis CA public key
in the app:

```bash
# On the Iabsis-controlled machine, generate the keypair once
cd backend
python manage.py hcw_keypair
# Keep PRIVATE_KEY offline (e.g. ~/.hcw/iabsis_private_key.b64)
# Copy PUBLIC_KEY into patient/src/app/core/security/iabsis-keys.ts
```

Each tenant must then receive a signature blob in its `instance_signature`
Constance variable, generated with:

```bash
python manage.py hcw_sign \
  --private-key-file ~/.hcw/iabsis_private_key.b64 \
  --host <tenant-fqdn> \
  --validity-days 365
```

#### Full rebuild (Angular + native)

```bash
cd patient/

# 1. Build the Angular bundle
npm run build

# 2. Push the new web assets and plugin updates into the Android project
npx cap sync android

# 3. Stop any stale Gradle daemon (important after JVM changes)
cd android
./gradlew --stop

# 4. Build the APK
./gradlew clean
./gradlew assembleDebug
# Output: patient/android/app/build/outputs/apk/debug/app-debug.apk
```

For a release build (signed):

```bash
./gradlew assembleRelease   # APK
./gradlew bundleRelease     # AAB for Play Store
```

Requires a release keystore configured in `android/app/build.gradle`.

#### Install on a connected device

```bash
adb install -r app/build/outputs/apk/debug/app-debug.apk
```

#### Test a deeplink

```bash
adb shell am start -a android.intent.action.VIEW \
  -d "hcw://<tenant-fqdn>/login?email=test@example.com" \
  com.healthcare.patient

# Watch Capacitor logs
adb logcat -s Capacitor:V chromium:I
```

#### Common build issues

| Error | Cause / Fix |
|---|---|
| `error: invalid source release: 21` | Gradle is using a JDK older than 21. Check `org.gradle.java.home` in `android/gradle.properties`, then `./gradlew --stop`. |
| `SDK location not found` | `android/local.properties` is missing. Recreate with `sdk.dir=/usr/lib/android-sdk`. |
| `cannot find symbol adjustMarginsForEdgeToEdge` | Capacitor packages are misaligned. Run `npm list @capacitor/android @capacitor/core` — every Capacitor package must share the same major (currently 7.6.x). |
| `Failed to find target with hash string 'android-35'` | Install the platform: `sudo apt install google-android-platform-35-installer`. |
| App opens but every deeplink shows "untrusted-instance" | Either `IABSIS_PUBLIC_KEY_B64` is empty in `iabsis-keys.ts`, or the tenant has no valid `instance_signature` in Constance. |
