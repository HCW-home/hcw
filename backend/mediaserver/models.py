from django.db import models

# Create your models here.


class Server(models.Model):
    url = models.URLField()
    api_secret = models.CharField()
    max_session_number = models.IntegerField(default=10)
    is_active = models.BooleanField(default=True)

    def __str__(self):
        return self.url