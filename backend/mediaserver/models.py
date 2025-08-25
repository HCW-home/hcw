from django.db import models

# Create your models here.
class Server(models.Model):
    url = models.URLField()
    api_secret = models.CharField()
    max_session_number = models.IntegerField(default=10)
    is_active = models.BooleanField(default=True)

    def __str__(self):
        return self.url
    

class Turn(models.Model):
    login = models.CharField(null=True, blank=True)
    credential = models.CharField(null=True, blank=True)

class TurnURL(models.Model):
    turn = models.ForeignKey(Turn, on_delete=models.CASCADE)
    url = models.URLField(help_text="turn:// or ")

