import django_filters
from datetime import datetime
from zoneinfo import ZoneInfo
from .models import (
    Consultation,
    Appointment,
    ConsultationReadStatus,
    Message,
    Reminder,
    Request,
)
from .utils import appointment_active_cutoff
from django.db.models import Exists, OuterRef, Subquery, Value
from django.db.models.functions import Coalesce
from django.utils import timezone

EPOCH = datetime(1970, 1, 1, tzinfo=ZoneInfo("UTC"))


def has_unread_messages(user):
    """Exists() subquery: the consultation has at least one message unread by
    ``user`` (created after the user's last read, by someone else, not deleted).
    Mirrors annotate_unread_count() in views.py.
    """
    last_read_sq = ConsultationReadStatus.objects.filter(
        consultation=OuterRef("pk"),
        user=user,
    ).values("last_read_at")[:1]
    return Exists(
        Message.objects.filter(
            consultation=OuterRef("pk"),
            deleted_at__isnull=True,
            created_at__gt=Coalesce(Subquery(last_read_sq), Value(EPOCH)),
        ).exclude(created_by=user)
    )

class ConsultationFilter(django_filters.FilterSet):
    # Custom boolean filter to check if closed_at is set
    is_closed = django_filters.BooleanFilter(
        field_name="closed_at",
        lookup_expr="isnull",
        exclude=True  # so is_closed=True means closed_at is NOT null
    )
    scheduled = django_filters.BooleanFilter(method='filter_scheduled')
    unassigned_request = django_filters.BooleanFilter(method='filter_unassigned_request')

    class Meta:
        model = Consultation
        fields = [
            "group",
            "beneficiary",
            "created_by",
            "owned_by",
            "closed_at",
        ]

    def filter_scheduled(self, queryset, name, value):
        from .models import AppointmentStatus
        has_future = Exists(
            Appointment.objects.filter(
                consultation=OuterRef('pk'),
                scheduled_at__gte=appointment_active_cutoff(),
                status=AppointmentStatus.scheduled,
            )
        )
        # A consultation with unread messages always needs attention, so it
        # belongs in the "à traiter" tab even when a future appointment exists.
        user = getattr(self.request, "user", None)
        if value is None:
            return queryset
        if user is None or not user.is_authenticated:
            # No user context: fall back to appointment-only classification.
            return queryset.filter(has_future) if value else queryset.filter(~has_future)
        has_unread = has_unread_messages(user)
        if value is True:
            # "Planifié": future appointment AND nothing left to read.
            return queryset.filter(has_future & ~has_unread)
        # "À traiter": no future appointment OR unread messages.
        return queryset.filter(~has_future | has_unread)

    def filter_unassigned_request(self, queryset, name, value):
        # Consultations without an owner that originate from a Request,
        # i.e. queue-assigned and waiting for a practitioner to take over.
        has_request = Exists(Request.objects.filter(consultation=OuterRef('pk')))
        if value is True:
            return queryset.filter(owned_by__isnull=True).filter(has_request)
        elif value is False:
            return queryset.exclude(owned_by__isnull=True, pk__in=Request.objects.values('consultation_id'))
        return queryset


class AppointmentFilter(django_filters.FilterSet):
    future = django_filters.BooleanFilter(method='filter_future')
    participant_user = django_filters.NumberFilter(
        field_name='participant__user',
        lookup_expr='exact',
    )

    class Meta:
        model = Appointment
        fields = {
            "consultation": ['exact',],
            "status": ['exact',],
            'scheduled_at': ['date__gte', 'date__lte'],
        }

    def filter_future(self, queryset, name, value):
        cutoff = appointment_active_cutoff()
        if value is True:
            return queryset.filter(scheduled_at__gte=cutoff)
        elif value is False:
            return queryset.filter(scheduled_at__lt=cutoff)
        return queryset


class ReminderFilter(django_filters.FilterSet):
    future = django_filters.BooleanFilter(method='filter_future')

    class Meta:
        model = Reminder
        fields = {
            "consultation": ['exact',],
            "recipient": ['exact',],
            "is_active": ['exact',],
            'scheduled_at': ['date__gte', 'date__lte'],
        }

    def filter_future(self, queryset, name, value):
        now = timezone.now()
        if value is True:
            return queryset.filter(scheduled_at__gte=now)
        elif value is False:
            return queryset.filter(scheduled_at__lt=now)
        return queryset
