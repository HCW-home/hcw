import logging
import traceback
from datetime import datetime, timedelta
from typing import Dict, List, Tuple

import celery
import requests
from celery import chain, group
from django.conf import settings
from django.db.models import F, Q
from django.utils import timezone
from django_celery_results.models import TaskResult

from . import models
from .models import User

logger = logging.getLogger(__name__)


app = celery.Celery("tasks", broker="redis://localhost")
app.config_from_object("django.conf:settings", namespace="CELERY")
