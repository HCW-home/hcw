from django.apps import AppConfig
from django.db.models.signals import class_prepared


class UsersConfig(AppConfig):
    default_auto_field = 'django.db.models.BigAutoField'
    name = 'users'
