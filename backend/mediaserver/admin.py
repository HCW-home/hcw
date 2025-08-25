from django.contrib import admin
from .models import Server, Turn, TurnURL
from unfold.admin import ModelAdmin, TabularInline

# Register your models here.
from unfold.admin import ModelAdmin

class TurnURLInline(TabularInline):
    model = TurnURL
    fields = ['url']
    extra = 1

@admin.register(Turn)
class TurnAdmin(ModelAdmin):
    list_display = ['turn_urls', 'login']
    inlines = [TurnURLInline]
    
    def turn_urls(self, obj):
        return ', '.join([url.url for url in obj.turnurl_set.all()])
    turn_urls.short_description = 'URLs'

@admin.register(Server)
class ServerAdmin(ModelAdmin):
    list_display = [
        "url",
        "is_active",
    ]