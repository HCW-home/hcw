from django.core.management.base import BaseCommand
from django.contrib.auth import get_user_model
import redis
from django.conf import settings
import logging

User = get_user_model()
logger = logging.getLogger(__name__)


class Command(BaseCommand):
    help = 'Reset all users online status on server startup - clears database and Redis'

    def add_arguments(self, parser):
        parser.add_argument(
            '--quiet',
            action='store_true',
            help='Run quietly without detailed output',
        )

    def handle(self, *args, **options):
        quiet = options.get('quiet', False)
        
        if not quiet:
            self.stdout.write(self.style.WARNING('🔄 Resetting user online status...'))
        
        try:
            # Reset database - set all users to offline
            online_count = User.objects.filter(is_online=True).count()
            if online_count > 0:
                User.objects.filter(is_online=True).update(is_online=False)
                if not quiet:
                    self.stdout.write(f'📊 Reset {online_count} users to offline in database')
            else:
                if not quiet:
                    self.stdout.write('📊 No users were marked online in database')
            
            # Clear Redis connection tracking
            try:
                redis_client = redis.Redis(
                    host=settings.REDIS_HOST,
                    port=settings.REDIS_PORT,
                    decode_responses=True
                )
                
                # Find all user connection keys
                pattern = "user_connections:*"
                keys = list(redis_client.scan_iter(match=pattern))
                
                if keys:
                    # Delete all connection tracking keys
                    deleted_count = redis_client.delete(*keys)
                    if not quiet:
                        self.stdout.write(f'🗑️  Cleared {deleted_count} Redis connection keys')
                else:
                    if not quiet:
                        self.stdout.write('🗑️  No Redis connection keys to clear')
                
                # Test Redis connection
                redis_client.ping()
                if not quiet:
                    self.stdout.write('✅ Redis connection verified')
                    
            except redis.ConnectionError as e:
                self.stdout.write(
                    self.style.ERROR(f'❌ Redis connection failed: {e}')
                )
                self.stdout.write(
                    self.style.WARNING('⚠️  Online status tracking may not work properly')
                )
            except Exception as e:
                self.stdout.write(
                    self.style.ERROR(f'❌ Error clearing Redis: {e}')
                )
        
        except Exception as e:
            self.stdout.write(
                self.style.ERROR(f'❌ Error resetting online status: {e}')
            )
            return
        
        if not quiet:
            self.stdout.write(
                self.style.SUCCESS('✅ User online status reset completed')
            )
        
        # Log the reset for monitoring
        logger.info(f'User online status reset: {online_count} users set offline, Redis cleared')