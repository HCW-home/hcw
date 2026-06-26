import time
import asyncio
import uuid
from typing import Optional

from django.conf import settings
from django.db import connection
from livekit import api
from livekit.api import (
    AccessToken,
    ListRoomsRequest,
    RoomParticipantIdentity,
    MuteRoomTrackRequest,
    TrackType,
    LiveKitAPI,
    SendDataRequest,
    TwirpError,
    VideoGrants,
    S3Upload,
    EncodedFileOutput,
    StopEgressRequest,
    RoomCompositeEgressRequest,
)

from consultations.models import RecordingModeChoices

from . import BaseMediaserver
from ..exceptions import RemoteUnmuteDisabled


class Main(BaseMediaserver):
    name = "livekit"
    display_name = "LiveKit"

    def __init__(self, server):
        super().__init__(server)
        self._client: Optional[LiveKitAPI] = None

    @staticmethod
    def _build_identity(user) -> str:
        # Prefix with the tenant schema so identical user PKs across tenants
        # never collide on the shared LiveKit server, and logs carry tenant
        # context.
        schema = getattr(getattr(connection, "tenant", None), "schema_name", None)
        if schema:
            return f"{schema}:{user.pk}"
        return str(user.pk)

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

    def _build_jwt(self, room_name: str, user) -> str:
        video_grants = VideoGrants(
            room=room_name,
            room_join=True,
            can_publish=True,
            can_subscribe=True,
            # Practitioners moderate the call (e.g. remote-muting a participant
            # whose open mic is causing echo). The actual mute is performed
            # server-side via the API, but room_admin keeps the grant honest.
            room_admin=bool(getattr(user, "is_practitioner", False)),
        )
        return (
            AccessToken(
                api_key=self.server.api_token,
                api_secret=self.server.api_secret,
            )
            .with_grants(video_grants)
            .with_identity(self._build_identity(user))
            .with_name(user.name)
            .to_jwt()
        )

    def _build_response(self, room_uuid, user) -> dict:
        room_name = str(room_uuid)
        return {
            "provider": self.name,
            "url": self.server.url,
            "token": self._build_jwt(room_name, user),
            "room": room_name,
        }

    def appointment_participant_info(self, appointment, user):
        return self._build_response(appointment.room_uuid, user)

    def user_test_info(self, user, room_uuid=None):
        if room_uuid is None:
            room_uuid = uuid.uuid4()
        return self._build_response(room_uuid, user)

    def consultation_user_info(self, consultation, user):
        return self._build_response(consultation.room_uuid, user)

    def supports_remote_mute(self) -> bool:
        return True

    async def _mute_participant_async(self, room_name: str, identity: str, muted: bool) -> int:
        """Mute (or unmute) every audio track published by a participant.

        Returns the number of tracks affected. Raises if the participant is not
        found in the room.
        """
        async with LiveKitAPI(
            url=self.server.url,
            api_key=self.server.api_token,
            api_secret=self.server.api_secret,
        ) as client:
            participant = await client.room.get_participant(
                RoomParticipantIdentity(room=room_name, identity=identity)
            )

            affected = 0
            for track in participant.tracks:
                if track.type != TrackType.AUDIO:  # only microphone/audio tracks
                    continue
                try:
                    await client.room.mute_published_track(
                        MuteRoomTrackRequest(
                            room=room_name,
                            identity=identity,
                            track_sid=track.sid,
                            muted=muted,
                        )
                    )
                except TwirpError as e:
                    # LiveKit disables remote unmute by default; surface a clear
                    # business error instead of a raw 500.
                    if not muted and "unmute" in str(e).lower():
                        raise RemoteUnmuteDisabled() from e
                    raise
                affected += 1
            return affected

    def mute_participant(self, room_uuid, target_user, muted: bool = True) -> int:
        """Force-mute a participant's audio. Returns number of tracks affected."""
        room_name = str(room_uuid)
        identity = self._build_identity(target_user)
        return asyncio.run(
            self._mute_participant_async(room_name, identity, muted)
        )

    async def get_room_info(self, room_name: str):
        """Get information about a specific room"""
        async with LiveKitAPI(
            url=self.server.url,
            api_key=self.server.api_token,
            api_secret=self.server.api_secret,
        ) as client:
            # List all rooms and find the specific one
            list_request = ListRoomsRequest(names=[room_name])
            rooms_response = await client.room.list_rooms(list_request)

            if rooms_response.rooms:
                return rooms_response.rooms[0]
            return None

    async def start_room_recording(self, room_name: str, appointment_id: int, mode: str = RecordingModeChoices.SCREEN_RECORDING, options: dict = None) -> str:
        """Start recording a room using room composite egress"""
        if options is None:
            options = {}

        async with LiveKitAPI(
            url=self.server.url,
            api_key=self.server.api_token,
            api_secret=self.server.api_secret,
        ) as client:
            # Check if the room exists and has participants
            room_info = await self.get_room_info(room_name)

            if not room_info:
                raise ValueError(f"Room '{room_name}' does not exist. Make sure participants have joined the video call before starting recording.")

            if room_info.num_participants == 0:
                raise ValueError(f"Room '{room_name}' has no participants. At least one participant must be in the call before starting recording.")

            # S3 configuration from settings (LiveKit-specific)
            s3_upload = S3Upload(
                access_key=settings.LIVEKIT_S3_ACCESS_KEY,
                secret=settings.LIVEKIT_S3_SECRET_KEY,
                bucket=settings.LIVEKIT_S3_BUCKET_NAME,
                region=settings.LIVEKIT_S3_REGION,
                endpoint=settings.LIVEKIT_S3_ENDPOINT_URL,
                force_path_style=True,  # Required for MinIO/S3-compatible services
            )

            # File output configuration — extension and audio_only depend on mode
            recording_mode = RecordingModeChoices(mode)
            filepath = f"recordings/appointment_{appointment_id}_{int(time.time())}.{recording_mode.extension}"
            file_output = EncodedFileOutput(
                filepath=filepath,
                s3=s3_upload,
            )

            # Room composite request
            request = RoomCompositeEgressRequest(
                room_name=room_name,
                file_outputs=[file_output],
                audio_only=recording_mode.audio_only,
            )

            egress_info = await client.egress.start_room_composite_egress(request)
            return egress_info.egress_id, filepath

    async def stop_room_recording(self, egress_id: str) -> None:
        """Stop an ongoing recording"""
        async with LiveKitAPI(
            url=self.server.url,
            api_key=self.server.api_token,
            api_secret=self.server.api_secret,
        ) as client:
            request = StopEgressRequest(egress_id=egress_id)
            await client.egress.stop_egress(request)
