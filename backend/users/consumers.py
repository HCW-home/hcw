from channels.generic.websocket import AsyncJsonWebsocketConsumer
from .services import async_user_online_service
import logging

logger = logging.getLogger(__name__)


class UserOnlineStatusMixin:
    """
    Mixin for WebSocket consumers to automatically track user online status.
    
    This mixin provides automatic online status tracking when users connect/disconnect
    from WebSocket endpoints. It handles multiple connections per user using Redis.
    
    Usage:
        class MyConsumer(UserOnlineStatusMixin, AsyncJsonWebsocketConsumer):
            async def connect(self):
                await super().connect()
                # Your connection logic here
    """
    
    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.connection_id = None
        self.user_id = None
    
    async def connect(self):
        """
        Handle WebSocket connection and track user online status.
        Call this method first in your consumer's connect method.
        """
        # Get user from scope (set by JWT middleware)
        user = self.scope.get('user')
        
        if user and user.is_authenticated:
            self.user_id = user.id
            self.connection_id = async_user_online_service.generate_connection_id()

            try:
                # Track this connection
                connection_count = await async_user_online_service.add_user_connection(
                    self.user_id, 
                    self.connection_id
                )
                
                logger.info(f"User {self.user_id} connected via WebSocket. Connection ID: {self.connection_id}, Total connections: {connection_count}")
                
                # Accept the WebSocket connection
                await self.accept()
                
                # Optionally notify about online status change
                await self._on_user_online_status_changed(True, connection_count)
                
            except Exception as e:
                logger.error(f"Error tracking user {self.user_id} connection: {e}")
                await self.close(code=4000)
        else:
            # No authenticated user, close connection
            logger.warning("WebSocket connection attempted without authenticated user")
            await self.close(code=4001)
    
    async def disconnect(self, close_code):
        """
        Handle WebSocket disconnection and update user online status.
        Call this method in your consumer's disconnect method.
        """
        if self.user_id and self.connection_id:
            try:
                # Remove this connection
                remaining_connections = await async_user_online_service.remove_user_connection(
                    self.user_id,
                    self.connection_id
                )
                
                logger.info(f"User {self.user_id} disconnected from WebSocket. Connection ID: {self.connection_id}, Remaining connections: {remaining_connections}")
                
                # Optionally notify about online status change
                if remaining_connections == 0:
                    await self._on_user_online_status_changed(False, remaining_connections)
                
            except Exception as e:
                logger.error(f"Error removing user {self.user_id} connection: {e}")
        
        # Call parent disconnect
        await super().disconnect(close_code)
    
    async def _on_user_online_status_changed(self, is_online, connection_count):
        """
        Hook method called when user's online status changes.
        
        Override this method in your consumer to handle online status changes,
        such as broadcasting to other users or updating UI.
        
        Args:
            is_online (bool): True if user went online, False if went offline
            connection_count (int): Current number of connections for the user
        """
        pass
    
    async def get_user_connection_count(self):
        """
        Get the current connection count for the user.
        
        Returns:
            int: Number of active connections for the user
        """
        if self.user_id:
            return await async_user_online_service.get_user_connection_count(self.user_id)
        return 0
    
    async def is_current_user_online(self):
        """
        Check if the current user is online (has any active connections).
        
        Returns:
            bool: True if user has active connections, False otherwise
        """
        if self.user_id:
            return await async_user_online_service.is_user_online(self.user_id)
        return False


class UserStatusConsumer(UserOnlineStatusMixin, AsyncJsonWebsocketConsumer):
    """
    A general-purpose WebSocket consumer for user communications.
    
    This consumer handles:
    - User online status tracking
    - Real-time notifications
    - General user-to-user messaging
    - System-wide broadcasts
    
    WebSocket URL: ws/user/
    """
    
    async def connect(self):
        """Connect and join a user-specific group and system broadcasts"""
        await super().connect()
        
        if self.user_id:
            # Join user-specific group for notifications and direct messages
            user_group = f"user_{self.user_id}"
            await self.channel_layer.group_add(user_group, self.channel_name)
            
            # Join system broadcasts group for system-wide messages
            await self.channel_layer.group_add("system_broadcasts", self.channel_name)
    
    async def disconnect(self, close_code):
        """Disconnect and leave groups"""
        if self.user_id:
            user_group = f"user_{self.user_id}"
            await self.channel_layer.group_discard(user_group, self.channel_name)
            await self.channel_layer.group_discard("system_broadcasts", self.channel_name)
        
        await super().disconnect(close_code)
    
    async def receive_json(self, content, **kwargs):
        """
        Handle incoming WebSocket messages.
        
        Supported message types:
        - ping: Simple ping/pong for connection health
        - get_status: Get current online status information
        - send_message: Send message to another user
        - broadcast: Send message to all connected users (admin only)
        - join_group: Join a specific group for targeted messaging
        - leave_group: Leave a specific group
        """
        message_type = content.get('type')
        data = content.get('data', {})
        
        if message_type == 'ping':
            await self.send_json({
                'type': 'pong',
                'timestamp': content.get('timestamp')
            })
        
        elif message_type == 'get_status':
            connection_count = await self.get_user_connection_count()
            is_online = await self.is_current_user_online()
            
            await self.send_json({
                'type': 'status_response',
                'data': {
                    'user_id': self.user_id,
                    'is_online': is_online,
                    'connection_count': connection_count,
                    'connection_id': self.connection_id
                }
            })
        
        elif message_type == 'send_message':
            await self._handle_send_message(data)
        
        elif message_type == 'broadcast':
            await self._handle_broadcast(data)
        
        elif message_type == 'join_group':
            await self._handle_join_group(data)
        
        elif message_type == 'leave_group':
            await self._handle_leave_group(data)
        
        else:
            await self.send_json({
                'type': 'error',
                'message': f'Unknown message type: {message_type}'
            })
    
    async def _on_user_online_status_changed(self, is_online, connection_count):
        """
        Notify about online status changes.
        """
        await self.send_json({
            'type': 'status_changed',
            'data': {
                'user_id': self.user_id,
                'is_online': is_online,
                'connection_count': connection_count,
                'connection_id': self.connection_id
            }
        })
    
    async def consultation(self, event):
        await self.send_json({
            "event": "consultation",
            "consultation_id": event["consultation_id"],
            "state": event['state']
        })

    async def _handle_send_message(self, data):
        """
        Handle sending a message to another user.
        
        Expected data:
        - target_user_id: ID of the user to send message to
        - message: The message content
        - message_type: Optional type of message (default: 'user_message')
        """
        target_user_id = data.get('target_user_id')
        message = data.get('message')
        msg_type = data.get('message_type', 'user_message')
        
        if not target_user_id or not message:
            await self.send_json({
                'type': 'error',
                'message': 'target_user_id and message are required'
            })
            return
        
        try:
            # Get sender user info
            from django.contrib.auth import get_user_model
            User = get_user_model()
            sender = await User.objects.aget(id=self.user_id)
            
            # Send to target user's group
            target_group = f"user_{target_user_id}"
            await self.channel_layer.group_send(target_group, {
                'type': 'user_message',
                'data': {
                    'message_type': msg_type,
                    'from_user_id': self.user_id,
                    'from_username': sender.username,
                    'message': message,
                    'timestamp': content.get('timestamp')
                }
            })
            
            # Confirm sent
            await self.send_json({
                'type': 'message_sent',
                'data': {
                    'target_user_id': target_user_id,
                    'message': message
                }
            })
            
        except Exception as e:
            await self.send_json({
                'type': 'error',
                'message': f'Failed to send message: {str(e)}'
            })
    
    async def _handle_broadcast(self, data):
        """
        Handle broadcasting a message to all users (admin only).
        
        Expected data:
        - message: The message content
        - message_type: Optional type of message (default: 'system_broadcast')
        """
        # Check if user is staff/admin
        from django.contrib.auth import get_user_model
        User = get_user_model()
        try:
            user = await User.objects.aget(id=self.user_id)
            if not (user.is_staff or user.is_superuser):
                await self.send_json({
                    'type': 'error',
                    'message': 'Permission denied: Admin privileges required'
                })
                return
        except:
            await self.send_json({
                'type': 'error',
                'message': 'User not found'
            })
            return
        
        message = data.get('message')
        msg_type = data.get('message_type', 'system_broadcast')
        
        if not message:
            await self.send_json({
                'type': 'error',
                'message': 'message is required'
            })
            return
        
        # Broadcast to all users
        await self.channel_layer.group_send('system_broadcasts', {
            'type': 'system_broadcast',
            'data': {
                'message_type': msg_type,
                'from_user_id': self.user_id,
                'message': message,
                'timestamp': content.get('timestamp') if 'content' in locals() else None
            }
        })
        
        await self.send_json({
            'type': 'broadcast_sent',
            'data': {'message': message}
        })
    
    async def _handle_join_group(self, data):
        """
        Handle joining a custom group for targeted messaging.
        
        Expected data:
        - group_name: Name of the group to join
        """
        group_name = data.get('group_name')
        
        if not group_name:
            await self.send_json({
                'type': 'error',
                'message': 'group_name is required'
            })
            return
        
        # Add validation for allowed group names if needed
        allowed_prefixes = ['consultation_', 'organisation_', 'custom_']
        if not any(group_name.startswith(prefix) for prefix in allowed_prefixes):
            await self.send_json({
                'type': 'error',
                'message': f'Group name must start with one of: {allowed_prefixes}'
            })
            return
        
        await self.channel_layer.group_add(group_name, self.channel_name)
        await self.send_json({
            'type': 'group_joined',
            'data': {'group_name': group_name}
        })
    
    async def _handle_leave_group(self, data):
        """
        Handle leaving a custom group.
        
        Expected data:
        - group_name: Name of the group to leave
        """
        group_name = data.get('group_name')
        
        if not group_name:
            await self.send_json({
                'type': 'error',
                'message': 'group_name is required'
            })
            return
        
        await self.channel_layer.group_discard(group_name, self.channel_name)
        await self.send_json({
            'type': 'group_left',
            'data': {'group_name': group_name}
        })
    
    async def user_notification(self, event):
        """
        Handler for user-specific notifications sent via channel layer.
        """
        await self.send_json({
            'type': 'notification',
            'data': event['data']
        })
    
    async def user_message(self, event):
        """
        Handler for user-to-user messages sent via channel layer.
        """
        await self.send_json({
            'type': 'user_message',
            'data': event['data']
        })
    
    async def system_broadcast(self, event):
        """
        Handler for system-wide broadcasts sent via channel layer.
        """
        await self.send_json({
            'type': 'system_broadcast',
            'data': event['data']
        })