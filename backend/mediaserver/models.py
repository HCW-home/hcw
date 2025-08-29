from django.db import models
from django.utils.translation import gettext_lazy as _

# Create your models here.
class Server(models.Model):
    url = models.URLField(_('URL'))
    api_secret = models.CharField(_('API secret'))
    max_session_number = models.IntegerField(_('max session number'), default=10)
    is_active = models.BooleanField(_('is active'), default=True)

    class Meta:
        verbose_name = _('server')
        verbose_name_plural = _('servers')

    def __str__(self):
        return self.url
    

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

