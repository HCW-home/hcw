from django.db import models
from django.db.models import Q, Exists
from django.utils import timezone


class ConsultationQuerySet(models.QuerySet):
    """Custom QuerySet for Consultation model"""

    def active(self):
        return self.filter(closed_at__isnull=True)

    def overdue(self):
        from .models import Appointment, AppointmentStatus

        has_future_scheduled = Appointment.objects.filter(
            consultation=models.OuterRef('pk'),
            scheduled_at__gte=timezone.now(),
            status=AppointmentStatus.scheduled,
        )

        return self.active().exclude(Exists(has_future_scheduled))

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
