from django.apps import AppConfig
import logging

logger = logging.getLogger(__name__)

class ConfigurationConfig(AppConfig):
    default_auto_field = 'django.db.models.BigAutoField'
    name = 'configuration'

    def ready(self):
        from .models import Configuration
        try:
            # Only initialize if tables exist (avoid issues during migrations)
            if self._tables_exist():
                created_count = Configuration.initialize_defaults()
                if created_count > 0:
                    logger.info(f"Initialized {created_count} default configurations")
        except Exception as e:
            logger.warning(f"Could not initialize default configurations: {e}")

    def _tables_exist(self):
        from django.db import connection
        try:
            with connection.cursor() as cursor:
                cursor.execute("SELECT 1 FROM configuration_configuration LIMIT 1")
            return True
        except Exception:
            return False
