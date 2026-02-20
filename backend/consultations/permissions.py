from rest_framework import permissions


class IsPractitioner(permissions.BasePermission):
    """
    Permission that only allows access to practitioners.
    """

    def has_permission(self, request, view):
        return (
            request.user
            and request.user.is_authenticated
            and request.user.is_practitioner
        )
