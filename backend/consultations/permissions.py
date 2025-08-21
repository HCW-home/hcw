from rest_framework import permissions
from .models import Consultation

class ConsultationPermission(permissions.BasePermission):
    """
    Custom permission for consultations.
    - A user can see their own consultations
    - A user can see consultations from groups they belong to
    - A user can create consultations
    """

    def has_permission(self, request, view):
        return request.user and request.user.is_authenticated

    def has_object_permission(self, request, view, obj: Consultation):
        user = request.user

        # User can always access consultations they created
        if obj.created_by == user or obj.owned_by == user:
            return True

        # User can access consultations from groups they belong to
        if obj.group and user in obj.group.users.all():
            return True

        return False
