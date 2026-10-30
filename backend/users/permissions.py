"""What a practitioner may do to somebody else's account.

`/api/users/`, `/api/patients/`, `/api/practitioners/` and the FHIR `Patient`
and `Practitioner` aliases all serve the same `User` rows. These rules used to
live on the first endpoint only, so the others let any practitioner rewrite a
superuser's email and then reset their password (audit C-02).
"""
from django.utils.translation import gettext as _
from rest_framework import permissions, serializers

from .phone import normalize_phone_number

# What decides who can sign in to an account: the email and phone number
# codes and links are sent to, the `manual` method that hands the access link
# to practitioners instead, and `temporary`, which makes that link enough.
CONTACT_FIELDS = ("email", "mobile_phone_number", "communication_method", "temporary")


class CanManageUser(permissions.BasePermission):
    """Refuse any write on an account practitioners must leave alone.

    Staff and superusers are managed from the admin, group members hold
    back-office roles, and practitioners edit their own profile through
    /api/auth/user/. What remains are the patients and contacts practitioners
    create. Reads are left to the view's queryset.
    """

    def has_object_permission(self, request, view, obj):
        if request.method in permissions.SAFE_METHODS:
            return True
        if obj.is_superuser or obj.is_staff:
            self.message = _("Cannot update users with portal or super admin access.")
            return False
        if obj.groups.exists():
            self.message = _("Cannot update users who belong to a group.")
            return False
        if request.user.is_practitioner and obj.is_practitioner:
            self.message = _("Cannot update another practitioner.")
            return False
        return True


def _comparable(field, value):
    if field == "email":
        return (value or "").strip().lower() or None
    if field == "mobile_phone_number":
        return normalize_phone_number(value)
    return value


def check_contact_changes(user, values):
    """Refuse the contact changes that would hand `user`'s account over.

    Only claimed accounts are protected (see `User.is_claimed`): before that,
    correcting a mistyped address is the practitioner's job. Values equal to
    the stored ones are not changes, since the practitioner app sends the
    whole form back on every save.
    """
    if not user.is_claimed:
        return
    locked = {
        field: _("Only the patient can change this once they have signed in.")
        for field, value in values.items()
        if field in CONTACT_FIELDS
        and _comparable(field, value) != _comparable(field, getattr(user, field))
    }
    if locked:
        raise serializers.ValidationError(locked)
