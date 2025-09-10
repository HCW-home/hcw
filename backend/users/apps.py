from django.apps import AppConfig
from django.db.models.signals import class_prepared
import logging

logger = logging.getLogger(__name__)


class UsersConfig(AppConfig):
    default_auto_field = 'django.db.models.BigAutoField'
    name = 'users'

    def ready(self):
        """
        Called when Django is fully loaded.
        Reset user online status to handle server restarts.
        """
        # Only run this during normal server startup, not during migrations or other commands
        import sys
        import os
        
        # Skip during migrations, tests, or management commands (except server commands)
        if any(cmd in sys.argv for cmd in ['migrate', 'makemigrations', 'test', 'collectstatic', 'shell', 'reset_online_status']):
            return
            
        # Only reset during actual server startup
        if len(sys.argv) > 1 and sys.argv[1] in ['runserver', 'gunicorn', 'daphne', 'uvicorn']:
            try:
                # Import here to avoid circular imports
                from .services import user_online_service
                result = user_online_service.reset_all_online_status()
                
                if result['success']:
                    if result['database_reset'] > 0 or result['redis_cleared'] > 0:
                        logger.info(f"✅ Startup reset: {result['database_reset']} users offline, {result['redis_cleared']} Redis keys cleared")
                else:
                    logger.error(f"❌ Startup reset failed: {result.get('error', 'Unknown error')}")
                    
            except Exception as e:
                logger.error(f"❌ Error during startup online status reset: {e}")
