# middleware.py
from urllib.parse import parse_qs
from channels.middleware import BaseMiddleware
from channels.db import database_sync_to_async
from rest_framework_simplejwt.authentication import JWTAuthentication
from jwt import decode as InvalidTokenError


@database_sync_to_async
def get_user(validated_token):
    try:
        user = JWTAuthentication().get_user(validated_token)
        return user
    except:
        return None


class JWTAuthMiddleware(BaseMiddleware):
    async def __call__(self, scope, receive, send):
        query_string = parse_qs(scope["query_string"].decode())
        token = query_string.get("token", [None])[0]
        if token is None:
            scope["user"] = None
            return await super().__call__(scope, receive, send)

        try:
            validated_token = JWTAuthentication().get_validated_token(token)
            scope["user"] = await get_user(validated_token)
        except InvalidTokenError:
            scope["user"] = None

        return await super().__call__(scope, receive, send)
