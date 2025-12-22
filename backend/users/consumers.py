from channels.generic.websocket import AsyncJsonWebsocketConsumer
from django.contrib.auth import get_user_model
from .services import async_user_online_service
import logging

logger = logging.getLogger(__name__)


class UserOnlineStatusMixin:
    """Mixin for automatic WebSocket user online status tracking."""

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.connection_id = None
        self.user_id = None

    async def connect(self):
        """Handle WebSocket connection and track user online status."""
        user = self.scope.get('user')

        if not user or not user.is_authenticated:
            logger.warning("WebSocket connection attempted without authenticated user")
            await self.close(code=4001)
            return

        self.user_id = user.id
        self.connection_id = async_user_online_service.generate_connection_id()

        try:
            connection_count = await async_user_online_service.add_user_connection(
                self.user_id, self.connection_id
            )
            logger.info(f"User {self.user_id} connected (ID: {self.connection_id}, Total: {connection_count})")
            await self.accept()
            await self._on_status_changed(True, connection_count)
        except Exception as e:
            logger.error(f"Error tracking user {self.user_id} connection: {e}")
            await self.close(code=4000)

    async def disconnect(self, close_code):
        """Handle WebSocket disconnection and update user online status."""
        if self.user_id and self.connection_id:
            try:
                remaining = await async_user_online_service.remove_user_connection(
                    self.user_id, self.connection_id
                )
                logger.info(f"User {self.user_id} disconnected (ID: {self.connection_id}, Remaining: {remaining})")
                if remaining == 0:
                    await self._on_status_changed(False, remaining)
            except Exception as e:
                logger.error(f"Error removing user {self.user_id} connection: {e}")

        await super().disconnect(close_code)

    async def _on_status_changed(self, is_online, connection_count):
        """Override to handle online status changes."""


class WebsocketConsumer(UserOnlineStatusMixin, AsyncJsonWebsocketConsumer):
    """WebSocket consumer for user communications and online status tracking."""

    async def connect(self):
        """Connect and join user-specific and system broadcast groups."""
        await super().connect()

        if self.user_id:
            await self.channel_layer.group_add(f"user_{self.user_id}", self.channel_name)
            await self.channel_layer.group_add("system_broadcasts", self.channel_name)

    async def disconnect(self, close_code):
        """Disconnect and leave all groups."""
        if self.user_id:
            await self.channel_layer.group_discard(f"user_{self.user_id}", self.channel_name)
            await self.channel_layer.group_discard("system_broadcasts", self.channel_name)
        await super().disconnect(close_code)

    async def receive_json(self, content, **kwargs):
        """Handle incoming WebSocket messages."""
        msg_type = content.get('type')
        data = content.get('data', {})

        handlers = {
            'ping': self._handle_ping,
            'get_status': self._handle_get_status,
            'send_message': self._handle_send_message,
            'broadcast': self._handle_broadcast,
            'join_group': self._handle_join_group,
            'leave_group': self._handle_leave_group,
        }

        handler = handlers.get(msg_type)
        if handler:
            await handler(content, data)
        else:
            await self._send_error(f'Unknown message type: {msg_type}')

    async def _on_status_changed(self, is_online, connection_count):
        """Notify client about online status changes."""
        await self.send_json({
            'type': 'status_changed',
            'data': {
                'user_id': self.user_id,
                'is_online': is_online,
                'connection_count': connection_count,
                'connection_id': self.connection_id
            }
        })

    # Message handlers
    async def _handle_ping(self, content, _data):
        await self.send_json({
            'type': 'pong',
            'timestamp': content.get('timestamp')
        })

    async def _handle_get_status(self, _content, _data):
        connection_count = await async_user_online_service.get_user_connection_count(self.user_id)
        is_online = await async_user_online_service.is_user_online(self.user_id)

        await self.send_json({
            'type': 'status_response',
            'data': {
                'user_id': self.user_id,
                'is_online': is_online,
                'connection_count': connection_count,
                'connection_id': self.connection_id
            }
        })

    async def _handle_send_message(self, content, data):
        target_user_id = data.get('target_user_id')
        message = data.get('message')

        if not target_user_id or not message:
            await self._send_error('target_user_id and message are required')
            return

        try:
            User = get_user_model()
            sender = await User.objects.aget(id=self.user_id)

            await self.channel_layer.group_send(f"user_{target_user_id}", {
                'type': 'user_message',
                'data': {
                    'message_type': data.get('message_type', 'user_message'),
                    'from_user_id': self.user_id,
                    'message': message,
                    'timestamp': content.get('timestamp')
                }
            })

            await self.send_json({
                'type': 'message_sent',
                'data': {'target_user_id': target_user_id, 'message': message}
            })
        except Exception as e:
            await self._send_error(f'Failed to send message: {str(e)}')

    async def _handle_broadcast(self, content, data):
        try:
            User = get_user_model()
            user = await User.objects.aget(id=self.user_id)

            if not (user.is_staff or user.is_superuser):
                await self._send_error('Permission denied: Admin privileges required')
                return
        except Exception:
            await self._send_error('User not found')
            return

        message = data.get('message')
        if not message:
            await self._send_error('message is required')
            return

        await self.channel_layer.group_send('system_broadcasts', {
            'type': 'system_broadcast',
            'data': {
                'message_type': data.get('message_type', 'system_broadcast'),
                'from_user_id': self.user_id,
                'message': message,
                'timestamp': content.get('timestamp')
            }
        })

        await self.send_json({
            'type': 'broadcast_sent',
            'data': {'message': message}
        })

    async def _handle_join_group(self, _content, data):
        group_name = data.get('group_name')
        if not group_name:
            await self._send_error('group_name is required')
            return

        allowed_prefixes = ['consultation_', 'organisation_', 'custom_']
        if not any(group_name.startswith(prefix) for prefix in allowed_prefixes):
            await self._send_error(f'Group name must start with one of: {", ".join(allowed_prefixes)}')
            return

        await self.channel_layer.group_add(group_name, self.channel_name)
        await self.send_json({
            'type': 'group_joined',
            'data': {'group_name': group_name}
        })

    async def _handle_leave_group(self, _content, data):
        group_name = data.get('group_name')
        if not group_name:
            await self._send_error('group_name is required')
            return

        await self.channel_layer.group_discard(group_name, self.channel_name)
        await self.send_json({
            'type': 'group_left',
            'data': {'group_name': group_name}
        })

    # Channel layer event handlers
    async def consultation(self, event):
        await self.send_json({
            "event": "consultation",
            "consultation_id": event["consultation_id"],
            "state": event['state']
        })

    async def user_notification(self, event):
        await self.send_json({'type': 'notification', 'data': event['data']})

    async def user_message(self, event):
        await self.send_json({'type': 'user_message', 'data': event['data']})

    async def system_broadcast(self, event):
        await self.send_json({'type': 'system_broadcast', 'data': event['data']})

    # Utility methods
    async def _send_error(self, message):
        await self.send_json({'type': 'error', 'message': message})
