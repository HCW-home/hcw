from django.db import models

# Create your models here.

class Organisation(models.Model):
    name = models.CharField(max_length=200)
    logo_large = models.ImageField(upload_to='organisations/',  blank=True, null=True)
    logo_small = models.ImageField(upload_to='organisations/',  blank=True, null=True)
    primary_color = models.CharField(max_length=7, blank=True, null=True)

    def __str__(self):
        return self.name