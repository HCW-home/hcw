import base64
import uuid
from datetime import timedelta
from xml.etree import ElementTree as ET
from zoneinfo import ZoneInfo

from django.conf import settings
from django.http import HttpResponse
from django.utils import timezone
from django.utils.decorators import method_decorator
from django.views import View
from django.views.decorators.csrf import csrf_exempt

from consultations.models import Appointment, AppointmentStatus, Participant
from users.models import User

DAV = "DAV:"
CALDAV = "urn:ietf:params:xml:ns:caldav"
CS = "http://calendarserver.org/ns/"

NSMAP = {"D": DAV, "C": CALDAV, "CS": CS}


def _tag(ns, local):
    return f"{{{ns}}}{local}"


def _fmt(dt):
    if dt.tzinfo is None:
        dt = timezone.make_aware(dt)
    return dt.astimezone(ZoneInfo("UTC")).strftime("%Y%m%dT%H%M%SZ")


def _appointment_to_vcalendar(appointment):
    end_at = appointment.end_expected_at or (
        appointment.scheduled_at + timedelta(hours=1)
    )
    domain = getattr(settings, "SITE_DOMAIN", "hcw.local")

    description = ""
    if appointment.consultation:
        if appointment.consultation.title:
            description += f"Consultation: {appointment.consultation.title}"
        if appointment.consultation.description:
            if description:
                description += "\\n"
            description += appointment.consultation.description

    organizer_name = ""
    organizer_email = ""
    if appointment.created_by and appointment.created_by.email:
        organizer_name = (
            f"{appointment.created_by.first_name} "
            f"{appointment.created_by.last_name}"
        ).strip()
        organizer_email = appointment.created_by.email

    lines = [
        "BEGIN:VCALENDAR",
        "VERSION:2.0",
        "PRODID:-//HCW//CalDAV//EN",
        "CALSCALE:GREGORIAN",
        "BEGIN:VEVENT",
        f"UID:appointment-{appointment.pk}@{domain}",
        f"DTSTAMP:{_fmt(timezone.now())}",
        f"DTSTART:{_fmt(appointment.scheduled_at)}",
        f"DTEND:{_fmt(end_at)}",
        f"SUMMARY:{appointment.title or 'Consultation'}",
    ]
    if description:
        lines.append(f"DESCRIPTION:{description}")
    if appointment.type == "inPerson":
        lines.append("LOCATION:In Person")
    if organizer_email:
        lines.append(f"ORGANIZER;CN={organizer_name}:mailto:{organizer_email}")

    for participant in appointment.participant_set.filter(is_active=True).select_related("user"):
        user = participant.user
        if not user or not user.email:
            continue
        name = f"{user.first_name} {user.last_name}".strip() or user.email
        partstat = "ACCEPTED" if participant.is_confirmed else (
            "DECLINED" if participant.is_confirmed is False else "NEEDS-ACTION"
        )
        lines.append(
            f"ATTENDEE;CN={name};PARTSTAT={partstat};ROLE=REQ-PARTICIPANT:mailto:{user.email}"
        )

    status_map = {"scheduled": "CONFIRMED", "cancelled": "CANCELLED", "draft": "TENTATIVE"}
    lines.append(f"STATUS:{status_map.get(appointment.status, 'CONFIRMED')}")
    lines.append("SEQUENCE:0")
    lines.append("END:VEVENT")
    lines.append("END:VCALENDAR")
    return "\r\n".join(lines) + "\r\n"


def _parse_vcalendar(ics_data):
    """Parse a VCALENDAR string and extract VEVENT fields and attendees."""
    result = {}
    attendees = []
    in_vevent = False
    for line in ics_data.replace("\r\n", "\n").split("\n"):
        line = line.strip()
        if line == "BEGIN:VEVENT":
            in_vevent = True
            continue
        if line == "END:VEVENT":
            break
        if not in_vevent or ":" not in line:
            continue
        key_part, _, value = line.partition(":")
        key_base = key_part.split(";")[0]

        if key_base == "ATTENDEE":
            email = value.replace("mailto:", "").strip()
            # Parse PARTSTAT from params
            params = {
                p.split("=")[0]: p.split("=")[1]
                for p in key_part.split(";")[1:]
                if "=" in p
            }
            attendees.append({
                "email": email,
                "partstat": params.get("PARTSTAT", "NEEDS-ACTION"),
            })
        else:
            result[key_base] = value

    result["_attendees"] = attendees
    return result


def _parse_ics_datetime(value):
    """Parse an ICS datetime string to a timezone-aware datetime."""
    from datetime import datetime

    value = value.strip()
    if value.endswith("Z"):
        dt = datetime.strptime(value, "%Y%m%dT%H%M%SZ")
        return dt.replace(tzinfo=ZoneInfo("UTC"))
    try:
        dt = datetime.strptime(value, "%Y%m%dT%H%M%S")
        return timezone.make_aware(dt)
    except ValueError:
        return None


def _get_user_from_request(request):
    """Authenticate user via Basic Auth with email:password."""
    from django.contrib.auth import authenticate

    auth_header = request.META.get("HTTP_AUTHORIZATION", "")
    if not auth_header.startswith("Basic "):
        return None
    try:
        decoded = base64.b64decode(auth_header[6:]).decode("utf-8")
        username, _, password = decoded.partition(":")
        if not password:
            return None
        return authenticate(request, username=username, password=password)
    except Exception:
        return None


def _require_auth(request):
    """Return user or an HTTP 401 response."""
    user = _get_user_from_request(request)
    if user is None:
        response = HttpResponse("Unauthorized", status=401)
        response["WWW-Authenticate"] = 'Basic realm="HCW CalDAV"'
        return None, response
    return user, None


def _get_user_appointments(user):
    return (
        Appointment.objects.filter(
            participant__user=user,
            participant__is_active=True,
            status=AppointmentStatus.scheduled,
            scheduled_at__gte=timezone.now() - timedelta(days=90),
        )
        .select_related("consultation", "created_by")
        .distinct()
    )


def _appointment_etag(appointment):
    return f'"{appointment.pk}-{int(appointment.scheduled_at.timestamp())}"'


def _href_for_appointment(appointment):
    domain = getattr(settings, "SITE_DOMAIN", "hcw.local")
    return f"/caldav/calendar/appointment-{appointment.pk}@{domain}.ics"


@method_decorator(csrf_exempt, name="dispatch")
class CalDAVDiscoveryView(View):
    """Handle well-known CalDAV redirect and principal discovery."""

    def dispatch(self, request, *args, **kwargs):
        if request.method == "OPTIONS":
            return self._options_response()
        if request.method == "PROPFIND":
            return self._propfind(request)
        return HttpResponse(status=405)

    def _options_response(self):
        response = HttpResponse()
        response["DAV"] = "1, calendar-access"
        response["Allow"] = "OPTIONS, PROPFIND"
        return response

    def _propfind(self, request):
        user, err = _require_auth(request)
        if err:
            return err

        multistatus = ET.Element(_tag(DAV, "multistatus"))
        resp = ET.SubElement(multistatus, _tag(DAV, "response"))
        ET.SubElement(resp, _tag(DAV, "href")).text = "/caldav/"
        propstat = ET.SubElement(resp, _tag(DAV, "propstat"))
        prop = ET.SubElement(propstat, _tag(DAV, "prop"))

        ET.SubElement(prop, _tag(DAV, "current-user-principal")).append(
            _make_href("/caldav/principal/")
        )
        ET.SubElement(prop, _tag(DAV, "resourcetype")).append(
            ET.Element(_tag(DAV, "collection"))
        )

        ET.SubElement(propstat, _tag(DAV, "status")).text = "HTTP/1.1 200 OK"

        return _multistatus_response(multistatus)


@method_decorator(csrf_exempt, name="dispatch")
class CalDAVPrincipalView(View):
    """Handle principal PROPFIND to return calendar-home-set."""

    def dispatch(self, request, *args, **kwargs):
        if request.method == "PROPFIND":
            return self._propfind(request)
        if request.method == "OPTIONS":
            response = HttpResponse()
            response["DAV"] = "1, calendar-access"
            response["Allow"] = "OPTIONS, PROPFIND"
            return response
        return HttpResponse(status=405)

    def _propfind(self, request):
        user, err = _require_auth(request)
        if err:
            return err

        multistatus = ET.Element(_tag(DAV, "multistatus"))
        resp = ET.SubElement(multistatus, _tag(DAV, "response"))
        ET.SubElement(resp, _tag(DAV, "href")).text = "/caldav/principal/"
        propstat = ET.SubElement(resp, _tag(DAV, "propstat"))
        prop = ET.SubElement(propstat, _tag(DAV, "prop"))

        ET.SubElement(prop, _tag(DAV, "displayname")).text = (
            f"{user.first_name} {user.last_name}".strip() or user.email
        )
        home_set = ET.SubElement(prop, _tag(CALDAV, "calendar-home-set"))
        home_set.append(_make_href("/caldav/calendar/"))

        ET.SubElement(propstat, _tag(DAV, "status")).text = "HTTP/1.1 200 OK"

        return _multistatus_response(multistatus)


@method_decorator(csrf_exempt, name="dispatch")
class CalDAVCalendarView(View):
    """Handle calendar collection: PROPFIND, REPORT, GET, PUT, DELETE."""

    def dispatch(self, request, *args, **kwargs):
        method = request.method
        if method == "OPTIONS":
            return self._options_response()
        if method == "PROPFIND":
            return self._propfind(request)
        if method == "REPORT":
            return self._report(request)
        if method == "GET":
            return self._get(request, **kwargs)
        if method == "PUT":
            return self._put(request, **kwargs)
        if method == "DELETE":
            return self._delete(request, **kwargs)
        return HttpResponse(status=405)

    def _options_response(self):
        response = HttpResponse()
        response["DAV"] = "1, calendar-access"
        response["Allow"] = "OPTIONS, PROPFIND, REPORT, GET, PUT, DELETE"
        return response

    def _propfind(self, request):
        user, err = _require_auth(request)
        if err:
            return err

        filename = self.kwargs.get("filename")

        if filename:
            return self._propfind_resource(user, filename)
        return self._propfind_collection(user, request)

    def _propfind_collection(self, user, request):
        depth = request.META.get("HTTP_DEPTH", "1")

        multistatus = ET.Element(_tag(DAV, "multistatus"))

        # Collection itself
        resp = ET.SubElement(multistatus, _tag(DAV, "response"))
        ET.SubElement(resp, _tag(DAV, "href")).text = "/caldav/calendar/"
        propstat = ET.SubElement(resp, _tag(DAV, "propstat"))
        prop = ET.SubElement(propstat, _tag(DAV, "prop"))

        rt = ET.SubElement(prop, _tag(DAV, "resourcetype"))
        rt.append(ET.Element(_tag(DAV, "collection")))
        rt.append(ET.Element(_tag(CALDAV, "calendar")))

        user_name = f"{user.first_name} {user.last_name}".strip() or user.email
        ET.SubElement(prop, _tag(DAV, "displayname")).text = f"HCW - {user_name}"
        ET.SubElement(prop, _tag(CALDAV, "supported-calendar-component-set")).append(
            _make_comp("VEVENT")
        )
        ET.SubElement(prop, _tag(CS, "getctag")).text = str(
            int(timezone.now().timestamp())
        )

        ET.SubElement(propstat, _tag(DAV, "status")).text = "HTTP/1.1 200 OK"

        # Child resources
        if depth != "0":
            appointments = _get_user_appointments(user)
            for appt in appointments:
                self._add_resource_response(multistatus, appt)

        return _multistatus_response(multistatus)

    def _propfind_resource(self, user, filename):
        appointment = self._find_appointment(user, filename)
        if not appointment:
            return HttpResponse(status=404)

        multistatus = ET.Element(_tag(DAV, "multistatus"))
        self._add_resource_response(multistatus, appointment)
        return _multistatus_response(multistatus)

    def _add_resource_response(self, multistatus, appointment):
        resp = ET.SubElement(multistatus, _tag(DAV, "response"))
        ET.SubElement(resp, _tag(DAV, "href")).text = _href_for_appointment(appointment)
        propstat = ET.SubElement(resp, _tag(DAV, "propstat"))
        prop = ET.SubElement(propstat, _tag(DAV, "prop"))

        ET.SubElement(prop, _tag(DAV, "getetag")).text = _appointment_etag(appointment)
        ET.SubElement(prop, _tag(DAV, "getcontenttype")).text = "text/calendar; charset=utf-8"
        ET.SubElement(prop, _tag(DAV, "resourcetype"))

        ET.SubElement(propstat, _tag(DAV, "status")).text = "HTTP/1.1 200 OK"

    def _report(self, request):
        user, err = _require_auth(request)
        if err:
            return err

        appointments = _get_user_appointments(user)

        # Parse request body for calendar-multiget
        requested_hrefs = set()
        try:
            body = request.body
            if body:
                root = ET.fromstring(body)
                for href_el in root.findall(f".//{_tag(DAV, 'href')}"):
                    if href_el.text:
                        requested_hrefs.add(href_el.text.strip())
        except ET.ParseError:
            pass

        multistatus = ET.Element(_tag(DAV, "multistatus"))

        for appt in appointments:
            href = _href_for_appointment(appt)
            if requested_hrefs and href not in requested_hrefs:
                continue

            resp = ET.SubElement(multistatus, _tag(DAV, "response"))
            ET.SubElement(resp, _tag(DAV, "href")).text = href
            propstat = ET.SubElement(resp, _tag(DAV, "propstat"))
            prop = ET.SubElement(propstat, _tag(DAV, "prop"))

            ET.SubElement(prop, _tag(DAV, "getetag")).text = _appointment_etag(appt)
            caldata = ET.SubElement(prop, _tag(CALDAV, "calendar-data"))
            caldata.text = _appointment_to_vcalendar(appt)

            ET.SubElement(propstat, _tag(DAV, "status")).text = "HTTP/1.1 200 OK"

        return _multistatus_response(multistatus)

    def _get(self, request, **kwargs):
        user, err = _require_auth(request)
        if err:
            return err

        filename = kwargs.get("filename")
        if not filename:
            # Return full calendar as ICS
            appointments = _get_user_appointments(user)
            lines = [
                "BEGIN:VCALENDAR",
                "VERSION:2.0",
                "PRODID:-//HCW//CalDAV//EN",
                "CALSCALE:GREGORIAN",
            ]
            for appt in appointments:
                vcal = _appointment_to_vcalendar(appt)
                # Extract VEVENT from each VCALENDAR
                in_vevent = False
                for line in vcal.split("\r\n"):
                    if line == "BEGIN:VEVENT":
                        in_vevent = True
                    if in_vevent:
                        lines.append(line)
                    if line == "END:VEVENT":
                        in_vevent = False
            lines.append("END:VCALENDAR")
            ics = "\r\n".join(lines) + "\r\n"
            response = HttpResponse(ics, content_type="text/calendar; charset=utf-8")
            return response

        appointment = self._find_appointment(user, filename)
        if not appointment:
            return HttpResponse(status=404)

        ics = _appointment_to_vcalendar(appointment)
        response = HttpResponse(ics, content_type="text/calendar; charset=utf-8")
        response["ETag"] = _appointment_etag(appointment)
        return response

    def _put(self, request, **kwargs):
        user, err = _require_auth(request)
        if err:
            return err

        filename = kwargs.get("filename")
        if not filename:
            return HttpResponse(status=400)

        ics_data = request.body.decode("utf-8")
        fields = _parse_vcalendar(ics_data)

        summary = fields.get("SUMMARY", "Consultation")
        dtstart = _parse_ics_datetime(fields.get("DTSTART", ""))
        dtend = _parse_ics_datetime(fields.get("DTEND", ""))

        if not dtstart:
            return HttpResponse("Invalid DTSTART", status=400)

        # Try to find existing appointment
        appointment = self._find_appointment(user, filename)

        attendees = fields.get("_attendees", [])

        if appointment:
            # Update existing
            appointment.title = summary
            appointment.scheduled_at = dtstart
            if dtend:
                appointment.end_expected_at = dtend
            appointment.save(update_fields=["title", "scheduled_at", "end_expected_at"])

            self._sync_participants(appointment, user, attendees)

            response = HttpResponse(status=204)
            response["ETag"] = _appointment_etag(appointment)
            return response
        else:
            # Create new appointment
            appointment = Appointment.objects.create(
                title=summary,
                scheduled_at=dtstart,
                end_expected_at=dtend,
                created_by=user,
                status=AppointmentStatus.scheduled,
            )
            Participant.objects.create(
                appointment=appointment,
                user=user,
                is_active=True,
                is_invited=True,
                is_confirmed=True,
            )
            self._sync_participants(appointment, user, attendees)

            response = HttpResponse(status=201)
            response["ETag"] = _appointment_etag(appointment)
            response["Location"] = _href_for_appointment(appointment)
            return response

    def _delete(self, request, **kwargs):
        user, err = _require_auth(request)
        if err:
            return err

        filename = kwargs.get("filename")
        if not filename:
            return HttpResponse(status=400)

        appointment = self._find_appointment(user, filename)
        if not appointment:
            return HttpResponse(status=404)

        appointment.status = AppointmentStatus.cancelled
        appointment.save(update_fields=["status"])
        return HttpResponse(status=204)

    def _sync_participants(self, appointment, current_user, attendees):
        """Sync participants from ATTENDEE list in ICS data."""
        if not attendees:
            return

        attendee_emails = {a["email"].lower() for a in attendees}

        # Add new participants
        for attendee in attendees:
            email = attendee["email"].lower()
            if email == current_user.email.lower():
                # Update current user's partstat
                partstat = attendee["partstat"]
                Participant.objects.filter(
                    appointment=appointment, user=current_user
                ).update(
                    is_confirmed=True if partstat == "ACCEPTED" else (
                        False if partstat == "DECLINED" else None
                    )
                )
                continue

            target_user = User.objects.filter(email__iexact=email, is_active=True).first()
            if not target_user:
                continue

            partstat = attendee["partstat"]
            participant, created = Participant.objects.get_or_create(
                appointment=appointment,
                user=target_user,
                defaults={
                    "is_active": True,
                    "is_invited": True,
                    "is_confirmed": True if partstat == "ACCEPTED" else (
                        False if partstat == "DECLINED" else None
                    ),
                },
            )
            if not created:
                participant.is_active = True
                participant.is_confirmed = (
                    True if partstat == "ACCEPTED" else (
                        False if partstat == "DECLINED" else None
                    )
                )
                participant.save(update_fields=["is_active", "is_confirmed"])

        # Deactivate participants removed from attendee list
        existing = Participant.objects.filter(
            appointment=appointment, is_active=True
        ).select_related("user")
        for participant in existing:
            if participant.user_id == current_user.id:
                continue
            if participant.user.email and participant.user.email.lower() not in attendee_emails:
                participant.is_active = False
                participant.save(update_fields=["is_active"])

    def _find_appointment(self, user, filename):
        """Find an appointment by its CalDAV filename."""
        # filename: appointment-123@domain.ics
        if not filename:
            return None
        name = filename.replace(".ics", "")
        # Extract appointment ID from UID format
        parts = name.split("@")
        if not parts:
            return None
        uid_part = parts[0]  # appointment-123
        if not uid_part.startswith("appointment-"):
            return None
        try:
            appt_id = int(uid_part.replace("appointment-", ""))
        except (ValueError, IndexError):
            return None

        return (
            Appointment.objects.filter(
                pk=appt_id,
                participant__user=user,
                participant__is_active=True,
            )
            .select_related("consultation", "created_by")
            .first()
        )


def _make_href(path):
    el = ET.Element(_tag(DAV, "href"))
    el.text = path
    return el


def _make_comp(name):
    el = ET.Element(_tag(CALDAV, "comp"))
    el.set("name", name)
    return el


def _multistatus_response(multistatus):
    xml_str = ET.tostring(multistatus, encoding="unicode", xml_declaration=True)
    response = HttpResponse(xml_str, content_type="application/xml; charset=utf-8", status=207)
    response["DAV"] = "1, calendar-access"
    return response
