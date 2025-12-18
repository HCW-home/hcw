import django_filters
from .models import Consultation, Appointment

class ConsultationFilter(django_filters.FilterSet):
    # Custom boolean filter to check if closed_at is set
    is_closed = django_filters.BooleanFilter(
        field_name="closed_at",
        lookup_expr="isnull",
        exclude=True  # so is_closed=True means closed_at is NOT null
    )

    class Meta:
        model = Consultation
        fields = [
            "group",
            "beneficiary",
            "created_by",
            "owned_by",
            "closed_at",
        ]


class AppointmentFilter(django_filters.FilterSet):

    class Meta:
        model = Appointment
        fields = [
            "consultation__beneficiary",
            "consultation__beneficiary",
            "consultation__created_by",
            "consultation__owned_by",
            "consultation__closed_at",
            "status"
        ]
