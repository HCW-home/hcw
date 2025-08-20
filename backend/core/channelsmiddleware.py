# middleware.py
from urllib.parse import parse_qs
from channels.middleware import BaseMiddleware
from channels.db import database_sync_to_async
from rest_framework_simplejwt.authentication import JWTAuthentication
from django.conf import settings


@database_sync_to_async
def get_user(validated_token):
    return JWTAuthentication().get_user(validated_token)

class CorsMiddleware(BaseMiddleware):
    """
    CORS middleware for Django Channels WebSocket connections
    """
    async def __call__(self, scope, receive, send):
        if scope["type"] == "websocket":
            # Only allow all origins in DEBUG mode
            scope["cors_allowed"] = settings.DEBUG
            
        return await super().__call__(scope, receive, send)

class JWTAuthMiddleware(BaseMiddleware):
    async def __call__(self, scope, receive, send):
        query_string = parse_qs(scope["query_string"].decode())
        token = query_string.get("token", [None])[0]

        validated_token = JWTAuthentication().get_validated_token(token)
        scope["user"] = await get_user(validated_token)

        return await super().__call__(scope, receive, send)
