from django.contrib import admin
from .models import MessagingProvider, Prefix

# Register your models here.
from unfold.admin import ModelAdmin, TabularInline


class PrefixInline(TabularInline):
    model = Prefix
    extra = 1
    show_change_link = True

# admin.site.register(MessagingProvider, ModelAdmin)


@admin.register(MessagingProvider)
class MessagingProviderAdmin(ModelAdmin):
    list_display = ['name', 'source_phone', 'priority', 'is_active']
    inlines = [PrefixInline]
