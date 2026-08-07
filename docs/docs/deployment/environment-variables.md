# Environment Variables

All backend configuration that must be known **before** Django starts (database, Redis, secrets, storage) is provided through environment variables. Everything else — site name, reminders, visibility rules, recording toggle, SSO — is configured at runtime from the admin interface, see [Advanced Options](../admin/advanced-options.md).

## Where to Set Them

| Deployment | Location |
|------------|----------|
| **Debian packages** | `/etc/hcw/backend.conf`, loaded by systemd (`EnvironmentFile=`) for the `hcw`, `hcw-celery` and `hcw-scheduler` services |
| **Docker Compose** | The `environment:` block of each service in `docker-compose.yml` |
| **Development** | `backend/.env`, loaded automatically at startup. Copy `backend/.env-dist` to get started |

The backend loads `backend/.env` if it exists, then falls back to the process environment. Variables set in the real environment always work, even without a `.env` file.

!!! warning "Restart required"
    Environment variables are read once at process startup. After any change, restart the API, the Celery worker **and** the scheduler — they each run in their own process and must share the same configuration.

## Django Core

| Variable | Default | Description |
|----------|---------|-------------|
| `DJANGOSECRET_KEY` | *(none)* | **Required.** Secret key used to sign sessions, tokens and password reset links. Generate one with `echo -n "your secret phrase" \| sha256sum`. Changing it invalidates all active sessions. |
| `DEBUG` | `False` | Set to the exact string `True` to enable debug mode. It also switches the cache from Redis to local memory and accepts every CORS origin. Never enable in production. |
| `ALLOWED_HOST` | *(none)* | Main hostname the backend is allowed to answer for. |
| `ALLOWED_HOSTS` | *(empty)* | Comma-separated list of additional hostnames, appended to `ALLOWED_HOST`. Use `*` to accept everything (development only). |
| `CSRF_TRUSTED_ORIGINS` | *(empty)* | Comma-separated list of origins **including the scheme** (e.g. `https://admin.example.com`). Required for the Django admin behind HTTPS. |
| `CORS_ALLOWED_ORIGINS` | *(empty)* | Comma-separated list of extra browser origins allowed to call the API. The Capacitor origins used by the mobile apps are always allowed. |
| `DEFAULT_TIME_ZONE` | `UTC` | Default timezone applied to new users, e.g. `Europe/Zurich`. |
| `STATIC_ROOT` | `statics` | Directory where `collectstatic` writes static files. The Debian package uses `/usr/share/hcw/backend/statics/`. |
| `MEDIA_ROOT` | `upload` | Directory where uploads are stored when S3 is not configured. Always use an absolute path: the API and the Celery worker are not started from the same working directory. |

## Maintenance Mode

Maintenance mode makes every HTTP request return a `503` without touching the database or Redis, which makes it usable even while the database is down.

| Variable | Default | Description |
|----------|---------|-------------|
| `MAINTENANCE` | `False` | Set to `True` to enable maintenance mode. |
| `MAINTENANCE_MESSAGE` | `The service is temporarily unavailable for maintenance. Please try again later.` | Message returned to clients. |
| `MAINTENANCE_RETRY_AFTER` | `300` | Value of the `Retry-After` header, in seconds. |

## Database

PostgreSQL is mandatory: multi-tenancy relies on PostgreSQL schemas.

| Variable | Default | Description |
|----------|---------|-------------|
| `DATABASE_NAME` | *(none)* | Database name. |
| `DATABASE_USER` | *(none)* | Database user. It must own the database to be able to create tenant schemas. |
| `DATABASE_PASSWORD` | *(none)* | User password. |
| `DATABASE_HOST` | *(none)* | Server hostname or IP address. |
| `DATABASE_PORT` | *(none)* | Server port, usually `5432`. |

## Redis

Redis is used as the Celery broker, as the cache, and as the WebSocket channel layer.

| Variable | Default | Description |
|----------|---------|-------------|
| `REDIS_HOST` | `127.0.0.1` | Redis hostname. |
| `REDIS_PORT` | `6379` | Redis port. |

## Email

| Variable | Default | Description |
|----------|---------|-------------|
| `EMAIL_HOST` | *(none)* | SMTP server hostname. |
| `EMAIL_PORT` | `25` | SMTP port. |
| `EMAIL_HOST_USER` | *(none)* | SMTP username, if authentication is required. |
| `EMAIL_HOST_PASSWORD` | *(none)* | SMTP password. |
| `EMAIL_USE_TLS` | *(disabled)* | Enables STARTTLS, typically on port 587. |
| `EMAIL_USE_SSL` | *(disabled)* | Enables implicit TLS, typically on port 465. Mutually exclusive with `EMAIL_USE_TLS`. |
| `DEFAULT_FROM_EMAIL` | *(none)* | Sender address used for all outgoing emails. |

!!! warning "TLS/SSL flags"
    `EMAIL_USE_TLS` and `EMAIL_USE_SSL` are enabled by **any** non-empty value, including `False` or `0`. To disable them, leave the variable out of the configuration entirely.

## Authentication

| Variable | Default | Description |
|----------|---------|-------------|
| `ACCESS_TOKEN_LIFETIME` | `3600` | JWT access token lifetime **in minutes** (the default is therefore 60 hours). Lower it to `60` for a one-hour lifetime. |
| `REFRESH_TOKEN_LIFETIME_DAYS` | `1` | Refresh token lifetime in days. Refresh tokens are rotated on every use. |

!!! note "SSO and password login"
    OpenID Connect providers and the "SSO only" toggle are no longer configured through the environment. Set them from the admin interface, see [Single Sign-On](../admin/sso.md) and [Advanced Options](../admin/advanced-options.md).

## File Storage (S3)

When S3 is configured, uploads (attachments, logos, recordings) are stored on an S3-compatible service instead of the local filesystem.

| Variable | Default | Description |
|----------|---------|-------------|
| `S3_BUCKET_NAME` | *(none)* | Bucket name. |
| `S3_ENDPOINT_URL` | *(none)* | Service endpoint, e.g. `https://s3.example.com` for MinIO or Ceph. |
| `S3_ACCESS_KEY` | *(none)* | Access key. |
| `S3_SECRET_KEY` | *(none)* | Secret key. |
| `S3_REGION` | `us-east-1` | Region. |
| `S3_VERIFY` | *(enabled)* | Set to the exact string `false` to skip TLS certificate verification (self-signed certificates). |
| `S3_ADDRESSING_STYLE` | `auto` | Addressing style: `auto`, `path` or `virtual`. MinIO and Ceph deployments whose bucket is not a DNS subdomain need `path`. |

!!! warning "All or nothing"
    `S3_BUCKET_NAME`, `S3_ENDPOINT_URL`, `S3_ACCESS_KEY` and `S3_SECRET_KEY` must be set together. A partial configuration aborts startup with an `ImproperlyConfigured` error rather than silently falling back to local storage, which would make files written by one process unreadable by another.

## Call Recording

Recordings are pushed to S3 by the media server. By default they reuse the `S3_*` settings above; set the `LIVEKIT_S3_*` variables only to store them on a different bucket or server.

| Variable | Default | Description |
|----------|---------|-------------|
| `LIVEKIT_S3_BUCKET_NAME` | value of `S3_BUCKET_NAME` | Bucket dedicated to recordings. |
| `LIVEKIT_S3_ENDPOINT_URL` | value of `S3_ENDPOINT_URL` | Endpoint dedicated to recordings. |
| `LIVEKIT_S3_ACCESS_KEY` | value of `S3_ACCESS_KEY` | Access key. |
| `LIVEKIT_S3_SECRET_KEY` | value of `S3_SECRET_KEY` | Secret key. |
| `LIVEKIT_S3_REGION` | value of `S3_REGION` | Region. |
| `RECORDING_CHECK_INITIAL_DELAY` | `120` | Seconds to wait after the call ends before looking for the file on S3. |
| `RECORDING_CHECK_MAX_RETRIES` | `4` | Number of retries after the first check. |
| `RECORDING_CHECK_RETRY_DELAY` | `30` | Seconds between two retries. |

Recording itself is enabled per tenant from the admin interface (`ENABLE_VIDEO_RECORDING`).

## Media Servers

| Variable | Default | Description |
|----------|---------|-------------|
| `ROOM_SERVER_PIN_TTL` | `86400` | How long, in seconds, the room-to-media-server mapping is kept in cache. Must outlast the longest possible call, including recording. |

Media servers themselves are declared from the admin interface, see [Media Servers](../admin/media-servers.md).

## Live Transcription

| Variable | Default | Description |
|----------|---------|-------------|
| `WHISPER_LIVE_URL` | `ws://127.0.0.1:9090` | WebSocket URL of the whisper-live server. |
| `WHISPER_LIVE_API_KEY` | *(empty)* | Must match the `--api_key` passed to the whisper-live server. Leave empty to disable authentication. |

Transcription is enabled per tenant from the admin interface (`ENABLE_LIVE_TRANSCRIPTION`).

## Push Notifications

| Variable | Default | Description |
|----------|---------|-------------|
| `WEBPUSH_VAPID_PUBLIC_KEY` | *(none)* | VAPID public key for browser web push. |
| `WEBPUSH_VAPID_PRIVATE_KEY` | *(none)* | Matching VAPID private key. |
| `WEBPUSH_VAPID_CLAIMS_EMAIL` | `mailto:admin@hcw-at-home.com` | Contact address sent to the push service, in `mailto:` form. |
| `GOOGLE_APPLICATION_CREDENTIALS` | *(none)* | Path to the Firebase service account JSON file, read by the Firebase SDK. Required for native mobile app notifications (FCM). |

## Antivirus (ClamAV)

Uploads are scanned only when one of these variables is set. `CLAMD_SOCKET` takes precedence over the TCP variables.

| Variable | Default | Description |
|----------|---------|-------------|
| `CLAMD_SOCKET` | *(none)* | Path to the clamd Unix socket, e.g. `/var/run/clamav/clamd.ctl`. |
| `CLAMD_TCP_ADDR` | `127.0.0.1` | clamd hostname, when connecting over TCP. |
| `CLAMD_TCP_SOCKET` | `3310` | clamd TCP port. |

## FHIR Server

| Variable | Default | Description |
|----------|---------|-------------|
| `FHIR_SYSTEM_SCHEME` | `https` | Scheme used in derived `Identifier.system` URLs. |
| `FHIR_SYSTEM_PATH` | *(empty)* | Optional path appended after the tenant domain, e.g. `/fhir`. Must start with `/`. |
| `FHIR_SYSTEM_BASE_URL` | *(none)* | Forces a single canonical base URL for every tenant, bypassing per-tenant derivation. |
| `FHIR_DEFAULT_COUNT` | `20` | Default number of resources per Bundle page. |
| `FHIR_MAX_COUNT` | `100` | Upper bound for the `_count` search parameter. |
| `FHIR_STRICT_SEARCH` | `False` | Set to `True` to reject unknown search parameters instead of ignoring them. |
| `FHIR_INCLUDE_NARRATIVE` | `True` | Include the human-readable `text` narrative in returned resources. |
| `FHIR_BUNDLE_TOTAL_MODE` | `accurate` | `accurate` returns the exact `total` in Bundles, `none` omits it (cheaper on large datasets). |

See [FHIR R4 Integration](../admin/fhir.md) for the full details of URL derivation.

## Mobile Applications

| Variable | Default | Description |
|----------|---------|-------------|
| `MOBILE_ANDROID_PACKAGE` | `com.healthcare.patient` | Android package name used to deep-link into the native app. |
| `MOBILE_ANDROID_STORE_URL` | Google Play URL of the default package | Store link offered when the app is not installed. |
| `MOBILE_IOS_STORE_URL` | *(empty)* | App Store link. Leave empty to hide the iOS banner. |
| `IABSIS_PUBLIC_KEY_B64` | *(Iabsis key)* | Base64 Ed25519 public key used to verify the instance signature. Only change it if you sign your instances with your own key and ship a matching native app. |

Each tenant can override the `MOBILE_*` values from the admin interface.

## Frontend Containers

The patient, practitioner and admin images are Nginx containers that proxy `/api` and `/ws` to the backend.

| Variable | Applies to | Description |
|----------|-----------|-------------|
| `BACKEND_URL` | `patient`, `practitioner`, `admin` | Internal URL of the API, e.g. `http://api:8000`. Substituted into the Nginx configuration at container startup. |
| `TAG` | `docker compose` | Image tag to pull, e.g. `TAG=0.10.0 docker compose pull`. Defaults to `latest`. |

## Deprecated Variables

`backend/.env-dist` still lists a few variables that are no longer read by the code. They are kept only for backward compatibility with older configuration files and can be removed.

| Variable | Replacement |
|----------|-------------|
| `USERS_VISIBILITY` | `USERS_VISIBILITY` option in [Advanced Options](../admin/advanced-options.md) |
| `OPENID_NAME`, `OPENID_CLIENT_ID`, `OPENID_SECRET`, `OPENID_CONFIGURATION_URL` | [Single Sign-On](../admin/sso.md) configuration in the admin interface |
| `DISABLE_PASSWORD_LOGIN` | `DISABLE_PASSWORD_LOGIN` option in [Advanced Options](../admin/advanced-options.md) |
| `ENABLE_REGISTRATION` | `ENABLE_REGISTRATION` option in [Advanced Options](../admin/advanced-options.md) |
| `ENCRYPTION_KEY` | No longer used. End-to-end encryption keys are managed per user, see [End-to-End Encryption](../admin/encryption.md) |

## Minimal Example

```ini
# Django
DJANGOSECRET_KEY=change-me
DEBUG=False
ALLOWED_HOST=hcw.example.com
ALLOWED_HOSTS=patient.example.com,admin.example.com
CSRF_TRUSTED_ORIGINS=https://admin.example.com
STATIC_ROOT=/usr/share/hcw/backend/statics/
MEDIA_ROOT=/var/lib/hcw/uploads
DEFAULT_TIME_ZONE=Europe/Zurich

# Database
DATABASE_NAME=hcw
DATABASE_USER=hcw
DATABASE_PASSWORD=change-me
DATABASE_HOST=127.0.0.1
DATABASE_PORT=5432

# Redis
REDIS_HOST=127.0.0.1
REDIS_PORT=6379

# Email
EMAIL_HOST=smtp.example.com
EMAIL_PORT=587
EMAIL_USE_TLS=1
EMAIL_HOST_USER=hcw@example.com
EMAIL_HOST_PASSWORD=change-me
DEFAULT_FROM_EMAIL=no-reply@example.com
```
