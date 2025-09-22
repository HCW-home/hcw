from django.test import TestCase
from django.contrib.auth import get_user_model
from django.test.utils import override_settings
from unittest.mock import patch, MagicMock, AsyncMock
from users.services import UserOnlineStatusService, UserMessagingService
from channels.testing import WebsocketCommunicator
from channels.db import database_sync_to_async
from users.consumers import WebsocketConsumer
import redis
import json

User = get_user_model()


@override_settings(
    REDIS_HOST='localhost',
    REDIS_PORT=6379
)
class UserOnlineStatusServiceTest(TestCase):
    """Test cases for UserOnlineStatusService"""
    
    def setUp(self):
        self.user = User.objects.create_user(
            username='testuser',
            email='test@example.com',
            password='testpass123'
        )
        
        # Mock Redis client
        self.mock_redis = MagicMock()
        self.service = UserOnlineStatusService()
        
    @patch('users.services.redis.Redis')
    def test_add_user_connection_first_connection(self, mock_redis_class):
        """Test adding the first connection for a user"""
        mock_redis_class.return_value = self.mock_redis
        self.mock_redis.sadd.return_value = 1
        self.mock_redis.scard.return_value = 1
        
        service = UserOnlineStatusService()
        connection_id = service.generate_connection_id()
        
        result = service.add_user_connection(self.user.id, connection_id)
        
        # Verify Redis operations
        self.mock_redis.sadd.assert_called_once()
        self.mock_redis.expire.assert_called_once()
        self.mock_redis.scard.assert_called_once()
        
        # Should return connection count
        self.assertEqual(result, 1)
    
    @patch('users.services.redis.Redis')  
    def test_add_user_connection_multiple_connections(self, mock_redis_class):
        """Test adding additional connections for a user"""
        mock_redis_class.return_value = self.mock_redis
        self.mock_redis.sadd.return_value = 1
        self.mock_redis.scard.return_value = 2
        
        service = UserOnlineStatusService()
        connection_id = service.generate_connection_id()
        
        result = service.add_user_connection(self.user.id, connection_id)
        
        # Should return connection count
        self.assertEqual(result, 2)
    
    @patch('users.services.redis.Redis')
    def test_remove_user_connection_with_remaining(self, mock_redis_class):
        """Test removing a connection when others remain"""
        mock_redis_class.return_value = self.mock_redis
        self.mock_redis.srem.return_value = 1
        self.mock_redis.scard.return_value = 1
        
        service = UserOnlineStatusService()
        connection_id = service.generate_connection_id()
        
        result = service.remove_user_connection(self.user.id, connection_id)
        
        # Verify Redis operations
        self.mock_redis.srem.assert_called_once()
        self.mock_redis.scard.assert_called_once()
        # Should not delete key when connections remain
        self.mock_redis.delete.assert_not_called()
        
        self.assertEqual(result, 1)
    
    @patch('users.services.redis.Redis')
    def test_remove_user_connection_last_connection(self, mock_redis_class):
        """Test removing the last connection for a user"""
        mock_redis_class.return_value = self.mock_redis
        self.mock_redis.srem.return_value = 1
        self.mock_redis.scard.return_value = 0
        
        service = UserOnlineStatusService()
        connection_id = service.generate_connection_id()
        
        result = service.remove_user_connection(self.user.id, connection_id)
        
        # Verify Redis operations
        self.mock_redis.srem.assert_called_once()
        self.mock_redis.scard.assert_called_once()
        # Should delete key when no connections remain
        self.mock_redis.delete.assert_called_once()
        
        self.assertEqual(result, 0)
    
    @patch('users.services.redis.Redis')
    def test_get_user_connection_count(self, mock_redis_class):
        """Test getting connection count for a user"""
        mock_redis_class.return_value = self.mock_redis
        self.mock_redis.scard.return_value = 3
        
        service = UserOnlineStatusService()
        
        result = service.get_user_connection_count(self.user.id)
        
        self.mock_redis.scard.assert_called_once()
        self.assertEqual(result, 3)
    
    @patch('users.services.redis.Redis')
    def test_is_user_online_true(self, mock_redis_class):
        """Test checking if user is online (has connections)"""
        mock_redis_class.return_value = self.mock_redis
        self.mock_redis.scard.return_value = 1
        
        service = UserOnlineStatusService()
        
        result = service.is_user_online(self.user.id)
        
        self.assertTrue(result)
    
    @patch('users.services.redis.Redis')
    def test_is_user_online_false(self, mock_redis_class):
        """Test checking if user is offline (no connections)"""
        mock_redis_class.return_value = self.mock_redis
        self.mock_redis.scard.return_value = 0
        
        service = UserOnlineStatusService()
        
        result = service.is_user_online(self.user.id)
        
        self.assertFalse(result)
    
    @patch('users.services.redis.Redis')
    def test_cleanup_user_connections(self, mock_redis_class):
        """Test cleaning up all connections for a user"""
        mock_redis_class.return_value = self.mock_redis
        
        service = UserOnlineStatusService()
        
        service.cleanup_user_connections(self.user.id)
        
        # Should delete the Redis key
        self.mock_redis.delete.assert_called_once()
    
    def test_generate_connection_id_unique(self):
        """Test that connection IDs are unique"""
        service = UserOnlineStatusService()
        
        id1 = service.generate_connection_id()
        id2 = service.generate_connection_id()
        
        self.assertNotEqual(id1, id2)
        self.assertIsInstance(id1, str)
        self.assertIsInstance(id2, str)


class UserModelTest(TestCase):
    """Test User model with is_online field"""
    
    def test_user_has_is_online_field(self):
        """Test that User model has is_online field"""
        user = User.objects.create_user(
            username='testuser',
            email='test@example.com',
            password='testpass123'
        )
        
        # Should have is_online field with default False
        self.assertFalse(user.is_online)
        
        # Should be able to update is_online
        user.is_online = True
        user.save()
        user.refresh_from_db()
        self.assertTrue(user.is_online)


class UserMessagingServiceTest(TestCase):
    """Test cases for UserMessagingService"""
    
    def setUp(self):
        self.user1 = User.objects.create_user(
            username='testuser1',
            email='test1@example.com',
            password='testpass123'
        )
        self.user2 = User.objects.create_user(
            username='testuser2',
            email='test2@example.com',
            password='testpass123',
            is_staff=True
        )
        self.messaging_service = UserMessagingService()
    
    @patch('channels.layers.get_channel_layer')
    async def test_send_notification_to_user(self, mock_get_channel_layer):
        """Test sending notification to a specific user"""
        mock_channel_layer = AsyncMock()
        mock_get_channel_layer.return_value = mock_channel_layer
        
        await self.messaging_service.send_notification_to_user(
            user_id=self.user1.id,
            title='Test Notification',
            message='This is a test message',
            data={'extra': 'info'}
        )
        
        mock_channel_layer.group_send.assert_called_once()
        call_args = mock_channel_layer.group_send.call_args
        self.assertEqual(call_args[0][0], f'user_{self.user1.id}')
        self.assertEqual(call_args[0][1]['type'], 'user_notification')
        self.assertEqual(call_args[0][1]['data']['title'], 'Test Notification')
        self.assertEqual(call_args[0][1]['data']['message'], 'This is a test message')
    
    @patch('channels.layers.get_channel_layer')
    async def test_send_message_to_user(self, mock_get_channel_layer):
        """Test sending direct message between users"""
        mock_channel_layer = AsyncMock()
        mock_get_channel_layer.return_value = mock_channel_layer
        
        await self.messaging_service.send_message_to_user(
            from_user_id=self.user1.id,
            target_user_id=self.user2.id,
            message='Hello there!',
            message_type='chat_message'
        )
        
        mock_channel_layer.group_send.assert_called_once()
        call_args = mock_channel_layer.group_send.call_args
        self.assertEqual(call_args[0][0], f'user_{self.user2.id}')
        self.assertEqual(call_args[0][1]['type'], 'user_message')
        self.assertEqual(call_args[0][1]['data']['from_user_id'], self.user1.id)
        self.assertEqual(call_args[0][1]['data']['message'], 'Hello there!')
    
    @patch('channels.layers.get_channel_layer')
    async def test_broadcast_system_message(self, mock_get_channel_layer):
        """Test broadcasting system message"""
        mock_channel_layer = AsyncMock()
        mock_get_channel_layer.return_value = mock_channel_layer
        
        await self.messaging_service.broadcast_system_message(
            message='System maintenance',
            message_type='maintenance_alert'
        )
        
        mock_channel_layer.group_send.assert_called_once()
        call_args = mock_channel_layer.group_send.call_args
        self.assertEqual(call_args[0][0], 'system_broadcasts')
        self.assertEqual(call_args[0][1]['type'], 'system_broadcast')
        self.assertEqual(call_args[0][1]['data']['message'], 'System maintenance')


@override_settings(
    CHANNEL_LAYERS={
        'default': {
            'BACKEND': 'channels.layers.InMemoryChannelLayer',
        },
    }
)
class UserStatusConsumerTest(TestCase):
    """Test cases for UserStatusConsumer WebSocket"""
    
    def setUp(self):
        self.user = User.objects.create_user(
            username='testuser',
            email='test@example.com',
            password='testpass123'
        )
        self.admin_user = User.objects.create_user(
            username='admin',
            email='admin@example.com',
            password='testpass123',
            is_staff=True
        )
    
    async def test_websocket_connect_authenticated(self):
        """Test WebSocket connection with authenticated user"""
        communicator = WebsocketCommunicator(WebsocketConsumer.as_asgi(), "/ws/user/")
        communicator.scope['user'] = self.user
        
        with patch('users.services.async_user_online_service') as mock_service:
            mock_service.generate_connection_id.return_value = 'test-conn-123'
            mock_service.add_user_connection.return_value = 1
            
            connected, subprotocol = await communicator.connect()
            self.assertTrue(connected)
            
            # Should call add_user_connection
            mock_service.add_user_connection.assert_called_once()
            
            await communicator.disconnect()
    
    async def test_websocket_connect_unauthenticated(self):
        """Test WebSocket connection with unauthenticated user"""
        from django.contrib.auth.models import AnonymousUser
        
        communicator = WebsocketCommunicator(WebsocketConsumer.as_asgi(), "/ws/user/")
        communicator.scope['user'] = AnonymousUser()
        
        connected, subprotocol = await communicator.connect()
        self.assertFalse(connected)
    
    async def test_ping_pong(self):
        """Test ping/pong functionality"""
        communicator = WebsocketCommunicator(WebsocketConsumer.as_asgi(), "/ws/user/")
        communicator.scope['user'] = self.user
        
        with patch('users.services.async_user_online_service') as mock_service:
            mock_service.generate_connection_id.return_value = 'test-conn-123'
            mock_service.add_user_connection.return_value = 1
            
            connected, subprotocol = await communicator.connect()
            self.assertTrue(connected)
            
            # Send ping
            await communicator.send_json_to({
                'type': 'ping',
                'timestamp': '2024-01-01T00:00:00Z'
            })
            
            # Should receive pong
            response = await communicator.receive_json_from()
            self.assertEqual(response['type'], 'pong')
            self.assertEqual(response['timestamp'], '2024-01-01T00:00:00Z')
            
            await communicator.disconnect()
    
    async def test_get_status(self):
        """Test getting current status"""
        communicator = WebsocketCommunicator(WebsocketConsumer.as_asgi(), "/ws/user/")
        communicator.scope['user'] = self.user
        
        with patch('users.services.async_user_online_service') as mock_service:
            mock_service.generate_connection_id.return_value = 'test-conn-123'
            mock_service.add_user_connection.return_value = 2
            mock_service.get_user_connection_count.return_value = 2
            mock_service.is_user_online.return_value = True
            
            connected, subprotocol = await communicator.connect()
            self.assertTrue(connected)
            
            # Send get_status
            await communicator.send_json_to({'type': 'get_status'})
            
            # Should receive status_response
            response = await communicator.receive_json_from()
            self.assertEqual(response['type'], 'status_response')
            self.assertEqual(response['data']['user_id'], self.user.id)
            self.assertTrue(response['data']['is_online'])
            self.assertEqual(response['data']['connection_count'], 2)
            
            await communicator.disconnect()
    
    async def test_send_message_to_user(self):
        """Test sending message to another user"""
        communicator = WebsocketCommunicator(WebsocketConsumer.as_asgi(), "/ws/user/")
        communicator.scope['user'] = self.user
        
        with patch('users.services.async_user_online_service') as mock_service:
            mock_service.generate_connection_id.return_value = 'test-conn-123'
            mock_service.add_user_connection.return_value = 1
            
            connected, subprotocol = await communicator.connect()
            self.assertTrue(connected)
            
            # Send message to another user
            await communicator.send_json_to({
                'type': 'send_message',
                'data': {
                    'target_user_id': self.admin_user.id,
                    'message': 'Hello admin!',
                    'message_type': 'chat_message'
                }
            })
            
            # Should receive message_sent confirmation
            response = await communicator.receive_json_from()
            self.assertEqual(response['type'], 'message_sent')
            self.assertEqual(response['data']['target_user_id'], self.admin_user.id)
            self.assertEqual(response['data']['message'], 'Hello admin!')
            
            await communicator.disconnect()
    
    async def test_broadcast_admin_only(self):
        """Test that broadcast is admin only"""
        # Test with regular user (should fail)
        communicator = WebsocketCommunicator(WebsocketConsumer.as_asgi(), "/ws/user/")
        communicator.scope['user'] = self.user
        
        with patch('users.services.async_user_online_service') as mock_service:
            mock_service.generate_connection_id.return_value = 'test-conn-123'
            mock_service.add_user_connection.return_value = 1
            
            connected, subprotocol = await communicator.connect()
            self.assertTrue(connected)
            
            # Try to send broadcast (should fail)
            await communicator.send_json_to({
                'type': 'broadcast',
                'data': {
                    'message': 'System message',
                    'message_type': 'announcement'
                }
            })
            
            # Should receive error
            response = await communicator.receive_json_from()
            self.assertEqual(response['type'], 'error')
            self.assertIn('Permission denied', response['message'])
            
            await communicator.disconnect()
    
    async def test_broadcast_admin_success(self):
        """Test that admin can broadcast"""
        communicator = WebsocketCommunicator(WebsocketConsumer.as_asgi(), "/ws/user/")
        communicator.scope['user'] = self.admin_user
        
        with patch('users.services.async_user_online_service') as mock_service:
            mock_service.generate_connection_id.return_value = 'test-conn-123'
            mock_service.add_user_connection.return_value = 1
            
            connected, subprotocol = await communicator.connect()
            self.assertTrue(connected)
            
            # Send broadcast (should succeed)
            await communicator.send_json_to({
                'type': 'broadcast',
                'data': {
                    'message': 'System message',
                    'message_type': 'announcement'
                }
            })
            
            # Should receive broadcast_sent confirmation
            response = await communicator.receive_json_from()
            self.assertEqual(response['type'], 'broadcast_sent')
            self.assertEqual(response['data']['message'], 'System message')
            
            await communicator.disconnect()
    
    async def test_join_leave_group(self):
        """Test joining and leaving groups"""
        communicator = WebsocketCommunicator(WebsocketConsumer.as_asgi(), "/ws/user/")
        communicator.scope['user'] = self.user
        
        with patch('users.services.async_user_online_service') as mock_service:
            mock_service.generate_connection_id.return_value = 'test-conn-123'
            mock_service.add_user_connection.return_value = 1
            
            connected, subprotocol = await communicator.connect()
            self.assertTrue(connected)
            
            # Join group
            await communicator.send_json_to({
                'type': 'join_group',
                'data': {
                    'group_name': 'consultation_123'
                }
            })
            
            response = await communicator.receive_json_from()
            self.assertEqual(response['type'], 'group_joined')
            self.assertEqual(response['data']['group_name'], 'consultation_123')
            
            # Leave group
            await communicator.send_json_to({
                'type': 'leave_group',
                'data': {
                    'group_name': 'consultation_123'
                }
            })
            
            response = await communicator.receive_json_from()
            self.assertEqual(response['type'], 'group_left')
            self.assertEqual(response['data']['group_name'], 'consultation_123')
            
            await communicator.disconnect()
    
    async def test_invalid_group_name(self):
        """Test joining group with invalid name"""
        communicator = WebsocketCommunicator(WebsocketConsumer.as_asgi(), "/ws/user/")
        communicator.scope['user'] = self.user
        
        with patch('users.services.async_user_online_service') as mock_service:
            mock_service.generate_connection_id.return_value = 'test-conn-123'
            mock_service.add_user_connection.return_value = 1
            
            connected, subprotocol = await communicator.connect()
            self.assertTrue(connected)
            
            # Try to join group with invalid name
            await communicator.send_json_to({
                'type': 'join_group',
                'data': {
                    'group_name': 'invalid_group_name'
                }
            })
            
            response = await communicator.receive_json_from()
            self.assertEqual(response['type'], 'error')
            self.assertIn('Group name must start with', response['message'])
            
            await communicator.disconnect()
    
    async def test_unknown_message_type(self):
        """Test handling unknown message type"""
        communicator = WebsocketCommunicator(WebsocketConsumer.as_asgi(), "/ws/user/")
        communicator.scope['user'] = self.user
        
        with patch('users.services.async_user_online_service') as mock_service:
            mock_service.generate_connection_id.return_value = 'test-conn-123'
            mock_service.add_user_connection.return_value = 1
            
            connected, subprotocol = await communicator.connect()
            self.assertTrue(connected)
            
            # Send unknown message type
            await communicator.send_json_to({
                'type': 'unknown_type'
            })
            
            response = await communicator.receive_json_from()
            self.assertEqual(response['type'], 'error')
            self.assertIn('Unknown message type', response['message'])
            
            await communicator.disconnect()