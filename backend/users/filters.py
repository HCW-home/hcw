from django.contrib.auth import get_user_model
from django.utils import timezone
from django.db.models import Q
from django_filters.rest_framework import BooleanFilter, FilterSet

User = get_user_model()


class UserFilter(FilterSet):
    has_group_permissions = BooleanFilter(method="filter_has_group_permissions")
    is_practitioner = BooleanFilter(field_name="is_practitioner")
    has_slots = BooleanFilter(method="filter_has_slots")

    class Meta:
        model = User
        fields = {
            "temporary": ["exact"],
        }

    def filter_has_group_permissions(self, queryset, name, value):
        if value is True:
            return queryset.filter(groups__isnull=False).distinct()
        elif value is False:
            return queryset.filter(groups__isnull=True)
        return queryset

    def filter_has_slots(self, queryset, name, value):
        today = timezone.now().date()
        slot_filter = Q(slots__isnull=False) & (
            Q(slots__valid_until__isnull=True) | Q(slots__valid_until__gte=today)
        )
        if value is True:
            return queryset.filter(slot_filter).distinct()
        elif value is False:
            return queryset.exclude(slot_filter).distinct()
        return queryset
