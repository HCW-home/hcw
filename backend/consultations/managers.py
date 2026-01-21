from django.db import models
from django.db.models import Q
from django.utils import timezone


class ConsultationManager(models.Manager):
    """Custom Manager for Consultation model"""

    def overdue(self, user):
        # Get consultations with no future scheduled appointments
        return (
            self.accessible_by(user)
            .filter(
                closed_at__isnull=True,
            )
            .exclude(
                appointments__scheduled_at__gte=timezone.now(),
                appointments__status='Scheduled',
            )
            .distinct()
        )

    def accessible_by(self, user):
        return self.filter(
            Q(owned_by=user)
            | Q(created_by=user)
            | Q(group__users=user),
        ).distinct()

    def active(self, user):
        return self.accessible_by(user).filter(
            closed_at__isnull=True,
        ).distinct()