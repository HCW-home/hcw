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
        """Consultations ``user`` takes part in professionally.

        Owner, creator, queue members and the participants the visibility flag
        let in — the people the case belongs to. This is also the scope that
        decides who may rewrite an appointment or close a follow-up, so it
        stays narrower than plain read access: ``consultation_access_q`` adds
        the beneficiary, who reads their own care without any say over it.
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
