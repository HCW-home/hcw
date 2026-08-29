from django.db import models
from django.db.models import Q


class ConsultationQuerySet(models.QuerySet):
    """Custom QuerySet for Consultation model"""

    @property
    def active(self):
        return self.filter(closed_at__isnull=True)


class ConsultationManager(models.Manager):
    """Custom Manager for Consultation model"""

    def get_queryset(self):
        return ConsultationQuerySet(self.model, using=self._db)

    def accessible_by(self, user, include_temporary=False):
        """Consultations ``user`` has authority over.

        This is the scope that also decides who may rewrite an appointment, so
        it stays narrow: a practitioner merely put on a roster reads the
        consultation (see ``roster_access_q``) without being able to alter it.
        """
        qs = self.filter(
            Q(owned_by=user)
            | Q(created_by=user)
            | Q(group__users=user)
            | Q(
                appointments__participant__user=user,
                appointments__participant__is_active=True,
                appointments__participant__is_consultation_visible=True,
            ),
        ).distinct()
        if not include_temporary:
            qs = qs.filter(temporary=False)
        return qs
