# HCW@Home V6

HCW@Home is a scalable, institution-level secure teleconsultation system designed for typical telemedicine scenarios. Fully open-source (GPLv3), it provides integrated features for chat, audio, and video calls via WebRTC/LiveKit.

## Key Features

- **Communication**: audio/video calls (LiveKit), real-time chat, screen sharing, multi-participant consultations
- **Scheduling**: calendar with FullCalendar, automated reminders, booking slots
- **Files**: file sharing, ClamAV antivirus, session recording (S3), PDF reports
- **Security**: JWT, OpenID Connect (SSO), patient authentication codes, role-based access control
- **Multi-tenant**: isolation by PostgreSQL schema, independent configuration per tenant
- **Multi-language**: English, French, German (extensible)
- **Administration**: modern interface (Unfold), user management, import/export, dashboards

## Deployment

Two deployment methods are supported:

- [**Docker Compose**](deployment/docker-compose.md): containerized deployment, ideal for development and cloud environments
- [**Debian Packages**](deployment/debian.md): native deployment on Debian/Ubuntu with systemd

## Use Cases

See the [Use Cases](use-cases/appointment-management.md) section to discover the scenarios supported by the solution.

## Links

- [Official Website](https://hcw-at-home.com/)
- [Source Code](https://github.com/HCW-home/hcw-home)
- [Translations](https://translate.iabsis.com/)
