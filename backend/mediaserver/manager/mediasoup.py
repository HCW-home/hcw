import logging
import uuid

import requests
from django.db import connection
from requests.auth import HTTPBasicAuth

from . import BaseMediaserver

logger = logging.getLogger(__name__)

# Mediasoup server REST endpoints (matches the SFU used in hcw-v5).
SESSION_PATH = "/session"
HEALTH_PATH = "/rooms-count"

DEFAULT_SESSION_TIMEOUT = 5  # seconds
DEFAULT_HEALTH_TIMEOUT = 3  # seconds


class Main(BaseMediaserver):
    name = "mediasoup"
    display_name = "MediaSoup"

    @staticmethod
    def _build_identity(user) -> str:
        # Mirror the LiveKit manager so identities are tenant-scoped on a
        # shared SFU and logs carry tenant context.
        schema = getattr(getattr(connection, "tenant", None), "schema_name", None)
        if schema:
            return f"{schema}:{user.pk}"
        return str(user.pk)

    def _auth(self) -> HTTPBasicAuth:
        return HTTPBasicAuth(self.server.api_token or "", self.server.api_secret or "")

    def _request_session(self, room_id: str, peer_id: str) -> str:
        resp = requests.post(
            f"{self.server.url.rstrip('/')}{SESSION_PATH}",
            json={"roomId": room_id, "peerId": peer_id},
            auth=self._auth(),
            timeout=DEFAULT_SESSION_TIMEOUT,
        )
        resp.raise_for_status()
        return resp.json()["token"]

    def _build_response(self, room_uuid, user) -> dict:
        room_id = str(room_uuid)
        peer_id = self._build_identity(user)
        token = self._request_session(room_id, peer_id)
        # The base URL is forwarded as-is so socket.io-client on the
        # frontend can append /socket.io/ and the auth query itself.
        return {
            "provider": self.name,
            "url": self.server.url.rstrip("/"),
            "token": token,
            "room": room_id,
            "identity": peer_id,
            "displayName": user.name or getattr(user, "email", "") or peer_id,
        }

    def test_connection(self):
        resp = requests.get(
            f"{self.server.url.rstrip('/')}{HEALTH_PATH}",
            auth=self._auth(),
            timeout=DEFAULT_HEALTH_TIMEOUT,
        )
        resp.raise_for_status()
        try:
            payload = resp.json()
        except ValueError:
            payload = resp.text
        return True, payload

    def appointment_participant_info(self, appointment, user):
        return self._build_response(appointment.room_uuid, user)

    def consultation_user_info(self, consultation, user):
        return self._build_response(consultation.room_uuid, user)

    def user_test_info(self, user, room_uuid=None):
        if room_uuid is None:
            room_uuid = uuid.uuid4()
        return self._build_response(room_uuid, user)

    def supports_recording(self):
        return False

    async def start_room_recording(self, *args, **kwargs):
        raise NotImplementedError("Recording is not supported by the mediasoup provider")

    async def stop_room_recording(self, *args, **kwargs):
        raise NotImplementedError("Recording is not supported by the mediasoup provider")
