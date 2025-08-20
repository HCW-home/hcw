from django.contrib import admin
from unfold.admin import ModelAdmin, TabularInline
from .models import Organisation
# Register your models here.


@admin.register(Organisation)
class OrganisationAdmin(ModelAdmin):
    pass
