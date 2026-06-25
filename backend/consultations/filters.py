import django_filters
from .models import Consultation, Appointment, Reminder, Request
from .utils import appointment_active_cutoff
from django.db.models import Exists, OuterRef
from django.utils import timezone

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
        if value is True:
            return queryset.filter(has_future)
        elif value is False:
            return queryset.filter(~has_future)
        return queryset

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
