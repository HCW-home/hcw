# Deployment with Debian Packages

This method installs HCW@Home directly on a Debian/Ubuntu server via `.deb` packages. Services are managed by systemd. This is the recommended approach for production deployments on dedicated infrastructure.

## Prerequisites

- Debian 13 (Trixie) or compatible
- PostgreSQL 15+
- Redis 7+
- Nginx
- Minimum 2 GB RAM

## Available Packages

The solution is distributed as three independent packages:

| Package | Content |
|---------|---------|
| `hcw-backend` | Django API, administration, Celery worker, scheduler |
| `hcw-practitioner` | Practitioner web interface (Angular) |
| `hcw-patient` | Patient web/mobile interface (Ionic) |

## Installation

### 1. Install system dependencies

```bash
apt install postgresql redis-server nginx
```

### 2. Create the database

```bash
su postgres
createuser -P hcw
# Put hcw as password
createdb -O hcw hcw
```

### 3. Install HCW packages

```bash
apt install hcw-backend hcw-practitioner hcw-patient
```

The installation automatically creates:

- A `hcw` system user
- The `/var/lib/hcw/` directory for uploads
- The systemd services

### 4. Configure the backend

Edit the configuration file:

```bash
nano /etc/hcw/backend.conf
```

!!! warning "Security"
    Generate an encryption key with: `echo -n "your secret phrase" | sha256sum`

For the full list of variables, see the [Docker Compose](docker-compose.md#environment-variables) page.

### 5. Create a tenant

HCW@Home uses multi-tenancy with PostgreSQL schema isolation. Each tenant has its own data, users, and configuration. Tenants are created via the Django shell.

```bash
cd /usr/share/hcw/backend
. ./venv/bin/activate
set -a ; source /etc/hcw/backend.conf
```

```bash
python manage.py create_tenant
```

* **schema name**: localhost
* **name**: localhost
* **domain**: 127.0.0.1

```bash
python manage.py tenant_command createsuperuser -s localhost
```

## Nginx Configuration

The `hcw-backend` package provides a reference Nginx configuration file. Copy and adapt it:

```bash
cp /usr/share/hcw/nginx /etc/nginx/sites-available/hcw
ln -s /etc/nginx/sites-available/hcw /etc/nginx/sites-enabled/
rm /etc/nginx/sites-enabled/default
nginx -t && systemctl reload nginx
```

The default configuration defines two server blocks:

!!! tip "HTTPS"
    In production, add a TLS certificate. With Let's Encrypt: `certbot --nginx -d your-domain.com -d patient.your-domain.com`

## Upgrading

```bash
apt update
apt install hcw-backend hcw-practitioner hcw-patient
```

Migrations are automatically applied on `hcw` service restart.

## Load Test Data (optional)

```bash
cd /usr/share/hcw/backend
sudo -u hcw venv/bin/python manage.py loaddata initial/TestData.json
```

Test1234