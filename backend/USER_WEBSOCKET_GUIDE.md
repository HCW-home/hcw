# User WebSocket System Guide

## Overview

The enhanced user WebSocket system (`ws/user/`) provides automatic online status tracking and real-time messaging capabilities. It handles:

- **User Online Status**: Automatic tracking when users connect/disconnect
- **Real-time Notifications**: Push notifications to specific users
- **Direct Messaging**: User-to-user messaging
- **System Broadcasts**: Admin broadcasts to all users
- **Group Messaging**: Join/leave groups for targeted messaging
- **Multiple Connection Support**: Handles multiple tabs/devices per user using Redis

## WebSocket Endpoints

### User WebSocket
- **URL**: `ws/user/`
- **Authentication**: JWT token required via query parameter: `ws/user/?token=YOUR_JWT_TOKEN`

### Consultation WebSocket (Enhanced)
- **URL**: `ws/consultation/{consultation_id}/`
- **Features**: Now includes automatic online status tracking

## Client-Side Usage Examples

### Basic Connection
```javascript
const token = 'your_jwt_token_here';
const ws = new WebSocket(`ws://localhost:8000/ws/user/?token=${token}`);

ws.onopen = function(event) {
    console.log('Connected to user WebSocket');
    
    // Get current status
    ws.send(JSON.stringify({
        type: 'get_status'
    }));
};

ws.onmessage = function(event) {
    const data = JSON.parse(event.data);
    console.log('Received:', data);
    
    switch(data.type) {
        case 'status_changed':
            console.log(`User ${data.data.user_id} is now ${data.data.is_online ? 'online' : 'offline'}`);
            break;
        case 'user_message':
            console.log(`Message from ${data.data.from_username}: ${data.data.message}`);
            break;
        case 'notification':
            console.log(`Notification: ${data.data.title} - ${data.data.message}`);
            break;
        case 'system_broadcast':
            console.log(`System: ${data.data.message}`);
            break;
    }
};
```

### Send Direct Message
```javascript
ws.send(JSON.stringify({
    type: 'send_message',
    data: {
        target_user_id: 123,
        message: 'Hello there!',
        message_type: 'chat_message'
    }
}));
```

### Join Group for Targeted Messaging
```javascript
ws.send(JSON.stringify({
    type: 'join_group',
    data: {
        group_name: 'consultation_456'
    }
}));
```

### Send System Broadcast (Admin only)
```javascript
ws.send(JSON.stringify({
    type: 'broadcast',
    data: {
        message: 'System maintenance in 10 minutes',
        message_type: 'maintenance_alert'
    }
}));
```

## Server-Side Integration

### Using the Messaging Service

```python
from users.services import user_messaging_service
from asgiref.sync import async_to_sync

# Send notification to user
async def notify_user(user_id, title, message):
    await user_messaging_service.send_notification_to_user(
        user_id=user_id,
        title=title,
        message=message,
        data={'action': 'show_popup'}
    )

# Send direct message between users
async def send_user_message(from_user_id, to_user_id, message):
    await user_messaging_service.send_message_to_user(
        from_user_id=from_user_id,
        target_user_id=to_user_id,
        message=message,
        message_type='direct_message'
    )

# Broadcast system message
async def broadcast_maintenance():
    await user_messaging_service.broadcast_system_message(
        message='System will be down for maintenance',
        message_type='maintenance_alert'
    )

# Send to specific group
async def notify_consultation_users(consultation_id, message):
    await user_messaging_service.send_to_group(
        group_name=f'consultation_{consultation_id}',
        message_type='consultation_update',
        data={'message': message, 'consultation_id': consultation_id}
    )
```

### Using in Views (Synchronous)
```python
from asgiref.sync import async_to_sync
from users.services import user_messaging_service

def some_view(request):
    # Notify user about something
    async_to_sync(user_messaging_service.send_notification_to_user)(
        user_id=request.user.id,
        title='Action Required',
        message='Please complete your profile'
    )
    
    return JsonResponse({'status': 'notification_sent'})
```

## Online Status Integration

### Check User Status
```python
from users.services import user_online_service

# Check if user is online
is_online = user_online_service.is_user_online(user_id=123)

# Get connection count
connections = user_online_service.get_user_connection_count(user_id=123)

# Get all online users
online_users = user_online_service.get_all_online_users()
```

### Database Integration
The `User.is_online` field is automatically updated when users connect/disconnect:

```python
from django.contrib.auth import get_user_model

User = get_user_model()

# Query online users
online_users = User.objects.filter(is_online=True)

# Check specific user
user = User.objects.get(id=123)
print(f"User {user.username} is {'online' if user.is_online else 'offline'}")
```

## Message Types Reference

### Incoming Message Types (Client → Server)
- `ping`: Health check (responds with `pong`)
- `get_status`: Get current online status
- `send_message`: Send message to another user
- `broadcast`: System broadcast (admin only)
- `join_group`: Join a messaging group
- `leave_group`: Leave a messaging group

### Outgoing Message Types (Server → Client)
- `pong`: Response to ping
- `status_response`: Current status information
- `status_changed`: Online status changed
- `user_message`: Direct message from another user
- `notification`: System notification
- `system_broadcast`: System-wide broadcast
- `message_sent`: Confirmation message was sent
- `group_joined`: Confirmation joined group
- `group_left`: Confirmation left group
- `error`: Error message

## Redis Keys Used

- `user_connections:{user_id}`: Set of active connection IDs per user
- Keys expire after 24 hours as safety net

## Integration with Existing Systems

### Consultation System
The `ConsultationConsumer` now inherits online status tracking automatically.

### Notification System
The `Notification` model now sends messages via both the old system (backward compatibility) and the new user WebSocket.

### Admin Integration
Staff users can send system broadcasts. Check `user.is_staff` or `user.is_superuser` for permissions.

## Security Considerations

- JWT authentication required for all connections
- Group names validated with allowed prefixes
- Admin privileges checked for broadcasts
- User isolation through individual groups

## Error Handling

The system handles:
- Redis connection failures (graceful degradation)
- Invalid message formats (error responses)
- Permission denied scenarios
- User not found cases
- Connection interruptions (automatic cleanup)

## Testing

Run the provided tests:
```bash
python manage.py test users.test_online_status
```

Check specific functionality:
```bash
python manage.py test users.test_online_status.UserModelTest
```