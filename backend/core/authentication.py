from django.contrib.auth.models import User
from django.contrib.auth.backends import BaseBackend
from rest_framework.exceptions import AuthenticationFailed
from .utils.alephium import verify_signature, pub_key_to_address
from users.models import User

class AlephiumAuthentication(BaseBackend):
    """
    Alephium signature based authentication.
    """
    def authenticate(self, request):
        hex_public_key = request.data.get("hex_public_key")
        timestamp_signature = request.data.get("timestamp_signature")
        timestamp = request.data.get("timestamp")

        if not hex_public_key or not timestamp_signature or not timestamp:
            return None

        try:
            verify_signature(hex_public_key, timestamp_signature, timestamp)
        except Exception as e:
            raise AuthenticationFailed(f"Invalid signature or timestamp: {e}")

        try:
            profile = User.objects.get(address=pub_key_to_address(hex_public_key))
        except User.DoesNotExist:
            profile = User.objects.create(
                address=pub_key_to_address(hex_public_key)
            )

        return (profile, None)