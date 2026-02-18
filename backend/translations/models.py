from django.db import models


class TranslationOverride(models.Model):
    COMPONENT_CHOICES = [
        ("patient", "Patient"),
        ("practitioner", "Practitioner"),
    ]

    component = models.CharField(max_length=20, choices=COMPONENT_CHOICES)
    language = models.CharField(max_length=10)
    key = models.CharField(max_length=255)
    value = models.TextField()

    class Meta:
        unique_together = ("component", "language", "key")
        ordering = ["component", "language", "key"]

    def __str__(self):
        return f"{self.component}/{self.language}: {self.key}"
