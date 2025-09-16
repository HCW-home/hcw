from rest_framework import permissions

class ConsultationAssigneePermission(permissions.BasePermission):
    """
    Permission class that checks both regular and assignee permissions.
    - Regular permissions (view_consultation, etc.): Full access to all consultations
    - Assignee permissions (assignee_view_consultation, etc.): Limited to assigned consultations
    """

    perms_map = {
        'GET': ['%(app_label)s.view_consultation', '%(app_label)s.assignee_view_consultation'],
        'OPTIONS': [],
        'HEAD': [],
        'POST': ['%(app_label)s.add_consultation'],
        'PUT': ['%(app_label)s.change_consultation', '%(app_label)s.assignee_change_consultation'],
        'PATCH': ['%(app_label)s.change_consultation', '%(app_label)s.assignee_change_consultation'],
        'DELETE': ['%(app_label)s.delete_consultation', '%(app_label)s.assignee_delete_consultation'],
    }

    def has_permission(self, request, view):
        if not request.user or not request.user.is_authenticated:
            return False

        # Get the model from the view
        if hasattr(view, 'get_queryset'):
            queryset = view.get_queryset()
            if queryset is not None:
                model_cls = queryset.model
            else:
                model_cls = getattr(view, 'model', None)
        else:
            model_cls = getattr(view, 'model', None)

        if model_cls is None:
            return False

        perms = self.get_required_permissions(request.method, model_cls)
        # Check if user has ANY of the required permissions (not ALL)
        return any(request.user.has_perm(perm) for perm in perms)

    def has_object_permission(self, request, view, obj):
        if not request.user or not request.user.is_authenticated:
            return False

        user = request.user

        # Check if user has regular consultation permission (full access)
        if user.has_perm('consultations.view_consultation'):
            return True

        # Check if user has assignee consultation permission AND is related to the consultation
        if user.has_perm('consultations.assignee_view_consultation'):
            return self.is_user_related_to_consultation(user, obj)

        return False

    def is_user_related_to_consultation(self, user, consultation):
        """Check if user is related to the consultation (owner, creator, or group member)"""
        # Handle case where obj might be an Appointment or Participant
        if hasattr(consultation, 'consultation'):
            consultation = consultation.consultation
        elif hasattr(consultation, 'appointment'):  # For Participant model
            consultation = consultation.appointment.consultation

        # User can access consultations they created or own
        if consultation.created_by == user or consultation.owned_by == user:
            return True

        # User can access consultations from groups they belong to
        if consultation.group and user in consultation.group.users.all():
            return True

        return False

    def get_required_permissions(self, method, model_cls):
        """Get the list of permissions required for this method and model"""
        app_label = model_cls._meta.app_label
        model_name = model_cls._meta.model_name

        if method not in self.perms_map:
            return []

        return [perm % {'app_label': app_label, 'model_name': model_name}
                for perm in self.perms_map[method]]
