from xml.etree import ElementTree as ET

from django.http import HttpResponse
from django.utils.decorators import method_decorator
from django.views import View
from django.views.decorators.csrf import csrf_exempt

from core.throttling import ratelimit
from dav.auth import require_auth

DAV = "DAV:"
CARDDAV = "urn:ietf:params:xml:ns:carddav"
CALDAV = "urn:ietf:params:xml:ns:caldav"

def _tag(ns, local):
    return f"{{{ns}}}{local}"

def _make_href(path):
    el = ET.Element(_tag(DAV, "href"))
    el.text = path
    return el

def _multistatus_response(multistatus):
    xml_str = ET.tostring(multistatus, encoding="unicode", xml_declaration=True)
    response = HttpResponse(
        xml_str, content_type="application/xml; charset=utf-8", status=207
    )
    response["DAV"] = "1, calendar-access, addressbook"
    return response

def _require_auth(request):
    """Return user or an HTTP 401 response."""
    return require_auth(request, realm="HCW DAV")

@method_decorator(
    ratelimit(rate="30/min", methods=["OPTIONS", "PROPFIND"], scope="dav"),
    name="dispatch",
)
@method_decorator(csrf_exempt, name="dispatch")
class DAVDiscoveryView(View):
    """Handle DAV root discovery for both CalDAV and CardDAV."""

    def dispatch(self, request, *args, **kwargs):
        if request.method == "OPTIONS":
            return self._options_response()
        if request.method == "PROPFIND":
            return self._propfind(request)
        return HttpResponse(status=405)

    def _options_response(self):
        response = HttpResponse()
        response["DAV"] = "1, calendar-access, addressbook"
        response["Allow"] = "OPTIONS, PROPFIND"
        return response

    def _propfind(self, request):
        user, err = _require_auth(request)
        if err:
            return err

        multistatus = ET.Element(_tag(DAV, "multistatus"))
        resp = ET.SubElement(multistatus, _tag(DAV, "response"))
        ET.SubElement(resp, _tag(DAV, "href")).text = "/dav/"
        propstat = ET.SubElement(resp, _tag(DAV, "propstat"))
        prop = ET.SubElement(propstat, _tag(DAV, "prop"))

        ET.SubElement(prop, _tag(DAV, "current-user-principal")).append(
            _make_href("/dav/principal/")
        )
        ET.SubElement(prop, _tag(DAV, "resourcetype")).append(
            ET.Element(_tag(DAV, "collection"))
        )

        ET.SubElement(propstat, _tag(DAV, "status")).text = "HTTP/1.1 200 OK"

        return _multistatus_response(multistatus)

@method_decorator(
    ratelimit(rate="30/min", methods=["OPTIONS", "PROPFIND"], scope="dav"),
    name="dispatch",
)
@method_decorator(csrf_exempt, name="dispatch")
class DAVPrincipalView(View):
    """Handle principal PROPFIND returning both calendar-home-set and addressbook-home-set."""

    def dispatch(self, request, *args, **kwargs):
        if request.method == "PROPFIND":
            return self._propfind(request)
        if request.method == "OPTIONS":
            response = HttpResponse()
            response["DAV"] = "1, calendar-access, addressbook"
            response["Allow"] = "OPTIONS, PROPFIND"
            return response
        return HttpResponse(status=405)

    def _propfind(self, request):
        user, err = _require_auth(request)
        if err:
            return err

        multistatus = ET.Element(_tag(DAV, "multistatus"))
        resp = ET.SubElement(multistatus, _tag(DAV, "response"))
        ET.SubElement(resp, _tag(DAV, "href")).text = "/dav/principal/"
        propstat = ET.SubElement(resp, _tag(DAV, "propstat"))
        prop = ET.SubElement(propstat, _tag(DAV, "prop"))

        ET.SubElement(prop, _tag(DAV, "displayname")).text = (
            f"{user.first_name} {user.last_name}".strip() or user.email
        )

        # Calendar home-set for CalDAV clients
        cal_home = ET.SubElement(prop, _tag(CALDAV, "calendar-home-set"))
        cal_home.append(_make_href("/dav/calendar/"))

        # Addressbook home-set for CardDAV clients
        adr_home = ET.SubElement(prop, _tag(CARDDAV, "addressbook-home-set"))
        adr_home.append(_make_href("/dav/addressbook/"))

        ET.SubElement(propstat, _tag(DAV, "status")).text = "HTTP/1.1 200 OK"

        return _multistatus_response(multistatus)
