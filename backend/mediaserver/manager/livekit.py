import asyncio

from livekit import api
from livekit.api import (
    AccessToken,
    ListRoomsRequest,
    LiveKitAPI,
    SendDataRequest,
    TwirpError,
    VideoGrants,
)

from . import BaseMediaserver


class Main(BaseMediaserver):
    name = "livekit"
    display_name = "LiveKit"

    def __init__(self, server):
        super().__init__(server)
        self._client = None

    @property
    def client(self):
        """Lazy initialization of client within async context"""
        if self._client is None:
            self._client = LiveKitAPI(
                self.server.url, self.server.api_token, self.server.api_secret
            )
        return self._client

    async def _test_connection_async(self):
        """Async implementation of test_connection"""
        async with LiveKitAPI(
            url=self.server.url,
            api_key=self.server.api_token,
            api_secret=self.server.api_secret,
        ) as client:
            req = ListRoomsRequest()
            return await client.room.list_rooms(req)

    def test_connection(self):
        """Synchronous wrapper for test_connection"""
        return asyncio.run(self._test_connection_async())

    async def _get_create_room(self, room_name: str):
        async with LiveKitAPI(
            url=self.server.url,
            api_key=self.server.api_token,
            api_secret=self.server.api_secret,
        ) as client:
            return await client.room.create_room(
                api.CreateRoomRequest(
                    name=room_name,
                    empty_timeout=10 * 60,  # 10 minutes avant suppression si vide
                    max_participants=10,
                )
            )

    def appointment_participant_info(self, participant):
        room_name = f"appointment_{participant.appointment.pk}"

        video_grants = VideoGrants(
            room=room_name,
            room_join=True,
            # room_admin=is_admin_or_owner,
            # can_update_own_metadata=True,
            can_publish=True,
            # can_publish_sources=sources,
            can_subscribe=True,
        )

        return (
            AccessToken(
                api_key=self.server.api_token,
                api_secret=self.server.api_secret,
            )
            .with_grants(video_grants)
            .with_identity(participant.pk)
            .with_name(participant.name)
            # .with_attributes(
            #     {"color": color, "room_admin": "true" if is_admin_or_owner else "false"}
            # )
            .to_jwt()
        )

    def user_test_info(self, user):

        room_name = f"usertest_{user.pk}"

        video_grants = VideoGrants(
            room=room_name,
            room_join=True,
            # room_admin=is_admin_or_owner,
            # can_update_own_metadata=True,
            can_publish=True,
            # can_publish_sources=sources,
            can_subscribe=True,
        )

        return (
            AccessToken(
                api_key=self.server.api_token,
                api_secret=self.server.api_secret,
            )
            .with_grants(video_grants)
            .with_identity(user.pk)
            .with_name(user.first_name)
            # .with_attributes(
            #     {"color": color, "room_admin": "true" if is_admin_or_owner else "false"}
            # )
            .to_jwt()
        )

    def consultation_user_info(self, consultation, user):
        pass
