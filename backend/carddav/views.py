import base64
import uuid
from xml.etree import ElementTree as ET

from django.conf import settings
from django.http import HttpResponse
from django.utils import timezone
from django.utils.decorators import method_decorator
from django.views import View
from django.views.decorators.csrf import csrf_exempt

from users.models import User, DAVAppPassword

DAV = "DAV:"
CARDDAV = "urn:ietf:params:xml:ns:carddav"

NSMAP = {"D": DAV, "C": CARDDAV}


def _tag(ns, local):
    return f"{{{ns}}}{local}"

def _get_user_from_request(request):
    """Authenticate via Basic Auth with email:password or DAVAppPassword."""
    from django.contrib.auth import authenticate

    auth_header = request.META.get("HTTP_AUTHORIZATION", "")
    if not auth_header.startswith("Basic "):
        return None
    try:
        decoded = base64.b64decode(auth_header[6:]).decode("utf-8")
        username, _, password = decoded.partition(":")
        if not password:
            return None
    except Exception:
        return None
    
    user = authenticate(request, username=username, password=password)
    if user:
        return user
    return DAVAppPassword.authenticate(username, password)

def _require_auth(request):
    """Return user or an HTTP 401 response."""
    user = _get_user_from_request(request)
    if user is None:
        response = HttpResponse("Unauthorized", status=401)
        response["WWW-Authenticate"] = 'Basic realm="HCW CardDAV"'
        return None, response
    return user, None

def _user_to_vcard(user):
    domain = getattr(settings, "SITE_DOMAIN", "hcw.local")
    uid = f"{'patient' if user.is_patient else 'practitioner'}-{user.pk}@{domain}"

    fn = f"{user.first_name} {user.last_name}".strip() or user.email

    lines = [
        "BEGIN:VCARD",
        "VERSION:3.0",
        f"UID:{uid}",
        f"FN:{fn}",
        f"N:{user.last_name or ''};{user.first_name or ''};;;",
    ]

    if user.email:
        lines.append(f"EMAIL;TYPE=INTERNET:{user.email}")

    if user.mobile_phone_number:
        lines.append(f"TEL;TYPE=CELL:{user.mobile_phone_number}")

    if user.date_of_birth:
        lines.append(f"BDAY:{user.date_of_birth.strftime('%Y%m%d')}")

    if user.job_title:
        lines.append(f"TITLE:{user.job_title}")

    if any([user.street, user.city, user.postal_code, user.country]):
        street = user.street or ""
        city = user.city or ""
        postal = user.postal_code or ""
        country = user.country or ""
        lines.append(f"ADR;TYPE=WORK:;;{street};{city};;{postal};{country}")

    if user.main_organisation_id:
        lines.append(f"ORG:{user.main_organisation.name}")

    role = "practitioner" if user.is_practitioner else "patient"
    lines.append(f"X-HCW-ROLE:{role}")

    lines.append("END:VCARD")
    return "\r\n".join(lines) + "\r\n"

def _user_etag(user):
    ref = user.updated_at or user.date_joined
    return f'"{user.pk}-{int(ref.timestamp())}"'

def _href_for_user(user):
    role = "practitioner" if user.is_practitioner else "patient"
    return f"/dav/addressbook/{role}-{user.pk}.vcf"

def _get_visible_contacts(user):
    """
    Return the queryset of users visible to the authenticated user.
    - Practitioners see their patients (created_by=user) and fellow practitioners.
    - Patients see the practitioners they have had appointments with.
    """
    if user.is_practitioner:
        patients = User.objects.filter(
            is_active=True,
            is_practitioner=False,
            created_by=user,
        ).select_related("main_organisation")
        practitioners = User.objects.filter(
            is_active=True,
            is_practitioner=True,
        ).exclude(pk=user.pk).select_related("main_organisation")
        return (patients | practitioners).distinct()
    else:
        return User.objects.filter(
            is_active=True,
            is_practitioner=True,
            appointments_participating__participant__user=user,
            appointments_participating__participant__is_active=True,
        ).select_related("main_organisation").distinct()

def _make_href(path):
    el = ET.Element(_tag(DAV, "href"))
    el.text = path
    return el

def _multistatus_response(multistatus):
    xml_str = ET.tostring(multistatus, encoding="unicode", xml_declaration=True)
    response = HttpResponse(
        xml_str, content_type="application/xml; charset=utf-8", status=207
    )
    response["DAV"] = "1, addressbook"
    return response


@method_decorator(csrf_exempt, name="dispatch")
class CardDAVAddressbookView(View):
    """Handle addressbook collection: PROPFIND, REPORT, GET."""

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
        return HttpResponse(status=405)

    def _options_response(self):
        response = HttpResponse()
        response["DAV"] = "1, addressbook"
        response["Allow"] = "OPTIONS, PROPFIND, REPORT, GET"
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
        ET.SubElement(resp, _tag(DAV, "href")).text = "/dav/addressbook/"
        propstat = ET.SubElement(resp, _tag(DAV, "propstat"))
        prop = ET.SubElement(propstat, _tag(DAV, "prop"))

        rt = ET.SubElement(prop, _tag(DAV, "resourcetype"))
        rt.append(ET.Element(_tag(DAV, "collection")))
        rt.append(ET.Element(_tag(CARDDAV, "addressbook")))

        user_name = f"{user.first_name} {user.last_name}".strip() or user.email
        ET.SubElement(prop, _tag(DAV, "displayname")).text = f"HCW - {user_name}"
        ET.SubElement(prop, _tag(DAV, "getctag")).text = str(
            int(timezone.now().timestamp())
        )

        ET.SubElement(propstat, _tag(DAV, "status")).text = "HTTP/1.1 200 OK"

        # Child resources
        if depth != "0":
            contacts = _get_visible_contacts(user)
            for contact in contacts:
                self._add_resource_response(multistatus, contact)

        return _multistatus_response(multistatus)

    def _propfind_resource(self, user, filename):
        contact = self._find_contact(user, filename)
        if not contact:
            return HttpResponse(status=404)

        multistatus = ET.Element(_tag(DAV, "multistatus"))
        self._add_resource_response(multistatus, contact)
        return _multistatus_response(multistatus)

    def _add_resource_response(self, multistatus, contact):
        resp = ET.SubElement(multistatus, _tag(DAV, "response"))
        ET.SubElement(resp, _tag(DAV, "href")).text = _href_for_user(contact)
        propstat = ET.SubElement(resp, _tag(DAV, "propstat"))
        prop = ET.SubElement(propstat, _tag(DAV, "prop"))

        ET.SubElement(prop, _tag(DAV, "getetag")).text = _user_etag(contact)
        ET.SubElement(prop, _tag(DAV, "getcontenttype")).text = "text/vcard; charset=utf-8"
        ET.SubElement(prop, _tag(DAV, "resourcetype"))

        ET.SubElement(propstat, _tag(DAV, "status")).text = "HTTP/1.1 200 OK"

    def _report(self, request):
        user, err = _require_auth(request)
        if err:
            return err

        contacts = _get_visible_contacts(user)

        # Parse request body for addressbook-multiget
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

        for contact in contacts:
            href = _href_for_user(contact)
            if requested_hrefs and href not in requested_hrefs:
                continue

            resp = ET.SubElement(multistatus, _tag(DAV, "response"))
            ET.SubElement(resp, _tag(DAV, "href")).text = href
            propstat = ET.SubElement(resp, _tag(DAV, "propstat"))
            prop = ET.SubElement(propstat, _tag(DAV, "prop"))

            ET.SubElement(prop, _tag(DAV, "getetag")).text = _user_etag(contact)
            carddata = ET.SubElement(prop, _tag(CARDDAV, "address-data"))
            carddata.text = _user_to_vcard(contact)

            ET.SubElement(propstat, _tag(DAV, "status")).text = "HTTP/1.1 200 OK"

        return _multistatus_response(multistatus)

    def _get(self, request, **kwargs):
        user, err = _require_auth(request)
        if err:
            return err

        filename = kwargs.get("filename")
        if not filename:
            return HttpResponse(status=400)

        contact = self._find_contact(user, filename)
        if not contact:
            return HttpResponse(status=404)

        vcard = _user_to_vcard(contact)
        response = HttpResponse(vcard, content_type="text/vcard; charset=utf-8")
        response["ETag"] = _user_etag(contact)
        return response

    def _find_contact(self, user, filename):
        """
        Find a contact by its CardDAV filename.
        filename format: patient-42.vcf or practitioner-7.vcf
        """
        if not filename:
            return None
        name = filename.replace(".vcf", "")
        if name.startswith("patient-"):
            role = "patient"
            pk_str = name.replace("patient-", "")
        elif name.startswith("practitioner-"):
            role = "practitioner"
            pk_str = name.replace("practitioner-", "")
        else:
            return None

        try:
            pk = int(pk_str)
        except ValueError:
            return None

        contacts = _get_visible_contacts(user)
        return contacts.filter(pk=pk).first()