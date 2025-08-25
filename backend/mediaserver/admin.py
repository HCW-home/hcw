from django.contrib import admin
from .models import Server, Turn, TurnURL
from unfold.admin import ModelAdmin, TabularInline

# Register your models here.
from unfold.admin import ModelAdmin

class TurnURLInline(TabularInline):
    model = TurnURL
    fields = ['url']

class TurnInline(TabularInline):
    model = Turn
    fields = ['server', 'login', 'password']
    extra = 1
    inlines = [TurnURLInline]

@admin.register(Server)
class ServerAdmin(ModelAdmin):
    list_display = [
        "url",
        "is_active",
    ]

    inlines = [TurnInline]
