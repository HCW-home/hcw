from django.db import models
from django.db.models import Q
from django.utils import timezone


class ConsultationQuerySet(models.QuerySet):
    """Custom QuerySet for Consultation model"""

    @property
    def active(self):
        return self.filter(closed_at__isnull=True)

    @property
    def overdue(self):
        from .models import AppointmentStatus
        # Get consultations with no future scheduled appointments
        return self.active.exclude(
            appointments__scheduled_at__gte=timezone.now(),
            appointments__status=AppointmentStatus.scheduled,
        ).distinct()
        
class ConsultationManager(models.Manager):
    """Custom Manager for Consultation model"""


    def get_queryset(self):
        return ConsultationQuerySet(self.model, using=self._db)

    def accessible_by(self, user):
        return self.filter(
            Q(owned_by=user)
            | Q(created_by=user)
            | Q(group__users=user),
        ).distinct()
