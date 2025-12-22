import redis
from django.conf import settings
from django.contrib.auth import get_user_model
from asgiref.sync import sync_to_async
import uuid
import logging

User = get_user_model()
logger = logging.getLogger(__name__)


class UserOnlineStatusService:
    """
    Service for tracking user online status using Redis.
    Handles multiple connections per user by tracking connection IDs.
    """
    
    def __init__(self):
        self.redis_client = redis.Redis(
            host=settings.REDIS_HOST,
            port=settings.REDIS_PORT,
            decode_responses=True
        )
        self.connection_key_prefix = "user_connections:"
    
    def _get_user_connections_key(self, user_id):
        """Get Redis key for storing user connections"""
        return f"{self.connection_key_prefix}{user_id}"
    
    def generate_connection_id(self):
        """Generate a unique connection ID"""
        return str(uuid.uuid4())
    
    def add_user_connection(self, user_id, connection_id):
        """
        Add a connection for a user and update their online status.
        
        Args:
            user_id (int): The user's ID
            connection_id (str): Unique connection identifier
            
        Returns:
            int: Number of active connections for the user
        """
        connections_key = self._get_user_connections_key(user_id)
        
        # Add connection to set
        self.redis_client.sadd(connections_key, connection_id)
        
        # Set expiration for the key (24 hours as safety net)
        self.redis_client.expire(connections_key, 86400)
        
        # Get current connection count
        connection_count = self.redis_client.scard(connections_key)
        
        # Update user online status if this is the first connection
        if connection_count == 1:
            self._update_user_online_status(user_id, True)
        
        logger.info(f"User {user_id} connected (connection {connection_id}). Total connections: {connection_count}")
        return connection_count
    
    def remove_user_connection(self, user_id, connection_id):
        """
        Remove a connection for a user and update their online status if no connections remain.
        
        Args:
            user_id (int): The user's ID
            connection_id (str): Connection identifier to remove
            
        Returns:
            int: Number of remaining active connections for the user
        """
        connections_key = self._get_user_connections_key(user_id)
        
        # Remove connection from set
        self.redis_client.srem(connections_key, connection_id)
        
        # Get remaining connection count
        connection_count = self.redis_client.scard(connections_key)
        
        # If no connections remain, set user offline and clean up key
        if connection_count == 0:
            self._update_user_online_status(user_id, False)
            self.redis_client.delete(connections_key)
        
        logger.info(f"User {user_id} disconnected (connection {connection_id}). Remaining connections: {connection_count}")
        return connection_count
    
    def get_user_connection_count(self, user_id):
        """
        Get the number of active connections for a user.
        
        Args:
            user_id (int): The user's ID
            
        Returns:
            int: Number of active connections
        """
        connections_key = self._get_user_connections_key(user_id)
        return self.redis_client.scard(connections_key)
    
    def is_user_online(self, user_id):
        """
        Check if a user has any active connections.
        
        Args:
            user_id (int): The user's ID
            
        Returns:
            bool: True if user has active connections, False otherwise
        """
        return self.get_user_connection_count(user_id) > 0
    
    def cleanup_user_connections(self, user_id):
        """
        Clean up all connections for a user (useful for maintenance).
        
        Args:
            user_id (int): The user's ID
        """
        connections_key = self._get_user_connections_key(user_id)
        self.redis_client.delete(connections_key)
        self._update_user_online_status(user_id, False)
        logger.info(f"Cleaned up all connections for user {user_id}")
    
    def _update_user_online_status(self, user_id, is_online):
        """
        Update the user's online status in the database.
        
        Args:
            user_id (int): The user's ID
            is_online (bool): Online status to set
        """
        try:
            User.objects.filter(id=user_id).update(is_online=is_online)
            status = "online" if is_online else "offline"
            logger.info(f"Updated user {user_id} status to {status}")
        except Exception as e:
            logger.error(f"Failed to update user {user_id} online status: {e}")
    
    def get_all_online_users(self):
        """
        Get all users that have active connections.
        
        Returns:
            list: List of user IDs that are online
        """
        pattern = f"{self.connection_key_prefix}*"
        online_users = []
        
        for key in self.redis_client.scan_iter(match=pattern):
            user_id = key.replace(self.connection_key_prefix, '')
            if self.redis_client.scard(key) > 0:
                try:
                    online_users.append(int(user_id))
                except ValueError:
                    continue
        
        return online_users
    
    def reset_all_online_status(self):
        """
        Reset all users to offline status and clear Redis connections.
        This should be called on server startup to handle server restarts.
        
        Returns:
            dict: Summary of reset operation
        """
        try:
            # Reset database - set all users to offline
            from django.contrib.auth import get_user_model
            User = get_user_model()
            
            online_count = User.objects.filter(is_online=True).count()
            if online_count > 0:
                User.objects.filter(is_online=True).update(is_online=False)
                logger.info(f"Reset {online_count} users to offline in database")
            
            # Clear all Redis connection keys
            pattern = f"{self.connection_key_prefix}*"
            keys = list(self.redis_client.scan_iter(match=pattern))
            redis_cleared = 0
            
            if keys:
                redis_cleared = self.redis_client.delete(*keys)
                logger.info(f"Cleared {redis_cleared} Redis connection keys")
            
            logger.info("User online status reset completed successfully")
            
            return {
                'database_reset': online_count,
                'redis_cleared': redis_cleared,
                'success': True
            }
            
        except Exception as e:
            logger.error(f"Error resetting online status: {e}")
            return {
                'database_reset': 0,
                'redis_cleared': 0,
                'success': False,
                'error': str(e)
            }


# Async wrapper for WebSocket consumers
class AsyncUserOnlineStatusService:
    """
    Async wrapper for UserOnlineStatusService to be used in WebSocket consumers.
    """
    
    def __init__(self):
        self.sync_service = UserOnlineStatusService()
    
    @sync_to_async
    def add_user_connection(self, user_id, connection_id):
        return self.sync_service.add_user_connection(user_id, connection_id)
    
    @sync_to_async
    def remove_user_connection(self, user_id, connection_id):
        return self.sync_service.remove_user_connection(user_id, connection_id)
    
    @sync_to_async
    def get_user_connection_count(self, user_id):
        return self.sync_service.get_user_connection_count(user_id)
    
    @sync_to_async
    def is_user_online(self, user_id):
        return self.sync_service.is_user_online(user_id)
    
    def generate_connection_id(self):
        return self.sync_service.generate_connection_id()
    
    @sync_to_async
    def cleanup_user_connections(self, user_id):
        return self.sync_service.cleanup_user_connections(user_id)


# Global instances
user_online_service = UserOnlineStatusService()
async_user_online_service = AsyncUserOnlineStatusService()


class UserMessagingService:
    """
    Service for sending messages to users via WebSocket.
    This service can be used by other parts of the application to send
    real-time messages to users through the user WebSocket consumer.
    """
    
    def __init__(self):
        from channels.layers import get_channel_layer
        self.channel_layer = get_channel_layer()
    
    async def send_notification_to_user(self, user_id, title, message, data=None):
        """
        Send a notification to a specific user.
        
        Args:
            user_id (int): Target user ID
            title (str): Notification title
            message (str): Notification message
            data (dict): Additional data to include
        """
        user_group = f"user_{user_id}"
        await self.channel_layer.group_send(user_group, {
            'type': 'user_notification',
            'data': {
                'title': title,
                'message': message,
                'data': data or {},
                'timestamp': str(datetime.now().isoformat())
            }
        })
    
    async def send_message_to_user(self, from_user_id, target_user_id, message, message_type='system_message'):
        """
        Send a direct message from one user to another.
        
        Args:
            from_user_id (int): Sender user ID
            target_user_id (int): Target user ID  
            message (str): Message content
            message_type (str): Type of message
        """
        from django.contrib.auth import get_user_model
        User = get_user_model()
        
        try:
            from_user = await User.objects.aget(id=from_user_id)
            target_group = f"user_{target_user_id}"
            
            await self.channel_layer.group_send(target_group, {
                'type': 'user_message',
                'data': {
                    'message_type': message_type,
                    'from_user_id': from_user_id,
                    'message': message,
                    'timestamp': str(datetime.now().isoformat())
                }
            })
        except Exception as e:
            logger.error(f"Failed to send message from user {from_user_id} to user {target_user_id}: {e}")
    
    async def broadcast_system_message(self, message, message_type='system_announcement'):
        """
        Broadcast a system message to all connected users.
        
        Args:
            message (str): Message content
            message_type (str): Type of message
        """
        await self.channel_layer.group_send('system_broadcasts', {
            'type': 'system_broadcast',
            'data': {
                'message_type': message_type,
                'message': message,
                'timestamp': str(datetime.now().isoformat())
            }
        })
    
    async def send_to_group(self, group_name, message_type, data):
        """
        Send a message to a specific group.
        
        Args:
            group_name (str): Group name (e.g., 'organisation_123', 'consultation_456')
            message_type (str): Type of message
            data (dict): Message data
        """
        await self.channel_layer.group_send(group_name, {
            'type': message_type,
            'data': data
        })


# Import datetime for messaging service
from datetime import datetime

# Global messaging service instance
user_messaging_service = UserMessagingService()