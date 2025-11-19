from django.db import models
from .manager import BaseMediaserver
from django.utils.translation import gettext_lazy as _
from importlib import import_module
from . import manager
from typing import Union

# Create your models here.
class Server(models.Model):
    url = models.URLField(_('URL'))
    api_token = models.CharField(_('API token'), blank=True, null=True)
    api_secret = models.CharField(_('API secret'), blank=True, null=True)
    max_session_number = models.IntegerField(_('max session number'), default=10)
    type = models.CharField(choices=manager.MAIN_DISPLAY_NAMES)
    is_active = models.BooleanField(_('is active'), default=True)

    class Meta:
        verbose_name = _('server')
        verbose_name_plural = _('servers')

    def __str__(self):
        return self.url

    @property
    def module(self):
        return import_module(f"..manager.{self.type}", __name__)

    @property
    def instance(self) -> BaseMediaserver:
        return self.module.Main(self)


class Turn(models.Model):
    login = models.CharField(_('login'), null=True, blank=True)
    credential = models.CharField(_('credential'), null=True, blank=True)

    class Meta:
        verbose_name = _('TURN server')
        verbose_name_plural = _('TURN servers')

class TurnURL(models.Model):
    turn = models.ForeignKey(Turn, on_delete=models.CASCADE, verbose_name=_('TURN server'))
    url = models.CharField(_('URL'), help_text=_('TURN URL (e.g., turn://example.com)'))

    class Meta:
        verbose_name = _('TURN URL')
        verbose_name_plural = _('TURN URLs')

