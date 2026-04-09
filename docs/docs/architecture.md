# Architecture

The solution is composed of several services:

| Service | Technology | Description |
|---------|------------|-------------|
| **API / Backend** | Django 5, Django REST Framework, Daphne (ASGI) | REST API, WebSocket, administration |
| **Celery Worker** | Celery | Asynchronous tasks (reminders, cleanup, notifications) |
| **Celery Beat** | Celery Beat | Periodic task scheduler |
| **Practitioner** | Angular 20 (PWA) | Web interface for practitioners |
| **Patient** | Ionic / Angular 20 | Web/mobile application for patients |
| **PostgreSQL** | PostgreSQL 15 | Database (multi-tenant by schema) |
| **Redis** | Redis 7 | Cache and message broker |
| **LiveKit** | LiveKit Server | Video/audio conferencing (WebRTC SFU) |
| **SMTP Server** | Any SMTP | Email delivery (invitations, reminders, notifications) |
| **SMS Gateway** *(optional)* | Twilio, etc. | SMS delivery for patient invitations |

## Overview Diagram

```mermaid
graph TD
    subgraph Clients
        PR[Practitioner<br/>Angular PWA]
        PA[Patient<br/>Ionic / Angular]
    end

    subgraph Backend
        API[Django API<br/>REST + WebSocket]
        CW[Celery Worker]
        CB[Celery Beat]
    end

    subgraph Infrastructure
        PG[(PostgreSQL)]
        RD[(Redis)]
        LK[LiveKit Server]
    end

    subgraph External
        SMTP[SMTP Server]
        SMS[SMS Gateway]
    end

    PR -->|REST / WS| API
    PA -->|REST / WS| API
    PR -->|WebRTC| LK
    PA -->|WebRTC| LK
    API --> PG
    API --> RD
    API --> LK
    CW --> PG
    CW --> RD
    CW --> SMTP
    CW --> SMS
    CB --> RD
```
