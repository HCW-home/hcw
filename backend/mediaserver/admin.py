from django.contrib import admin
from .models import Server

# Register your models here.
from unfold.admin import ModelAdmin


@admin.register(Server)
class SpecialityAdmin(ModelAdmin):
    list_display = [
        "url",
        "is_active",
    ]

