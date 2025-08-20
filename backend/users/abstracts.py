from django.db import models

class ModelOwnerAbstract(models.Model):
    user = models.ForeignKey('users.User', on_delete=models.CASCADE)
    user_encrypted = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        abstract = True

    class Encrypt:
        fields = []

