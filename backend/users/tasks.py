import logging
import celery
from django.utils import timezone
from . import models
from django_celery_results.models import TaskResult
from django.conf import settings

from datetime import datetime, timedelta
import logging
import traceback
import requests
from django.db.models import F, Q
from celery import chain, group
from typing import Dict, List, Tuple
from .models import User

logger = logging.getLogger(__name__)


app = celery.Celery('tasks', broker='redis://localhost')
app.config_from_object("django.conf:settings", namespace="CELERY")


@app.task(bind=True)
def encrypt_user_data(task_id, user_id: int, decrypt_key: str):
    user = User.objects.get(pk=user_id)
    user.recrypt(settings.ENCRYPTION_KEY, decrypt_key, True)


@app.task(bind=True)
def decrypt_user_data(task_id, user_id: int, decrypt_key: str):
    user = User.objects.get(pk=user_id)
    user.recrypt(decrypt_key, settings.ENCRYPTION_KEY, False)
