from django.db import models

class ModelCeleryAbstract(models.Model):
    # Celery task tracking
    celery_task_id = models.CharField(
        max_length=255, blank=True, help_text="Celery task ID for async sending")
    task_logs = models.TextField(
        blank=True, help_text="Logs from the sending task")

    class Meta:
        abstract = True
