from typing import Dict, Optional, Awaitable, Callable
from ..models import Server
from janus_client import JanusSession, JanusVideoRoomPlugin
from janus_client.transport import JanusTransport
import random
import logging

logger = logging.getLogger(__name__)

class VideoRoomWithEvents(JanusVideoRoomPlugin):
    """Subclass that forwards all async events to a user callback."""

    def __init__(self, on_event: Optional[Callable[[dict], Awaitable[None]]] = None):
        super().__init__()
        self._on_event = on_event

    async def on_receive(self, response: dict):
        if self._on_event:
            await self._on_event(response)
        


class Janus:

    def __init__(self, server: Server):
        self.server = server

        self.session = JanusSession(
            base_url=self.server.url, api_secret=self.server.api_secret)
        
        self.video_room = VideoRoomWithEvents(on_event=self.handle_event)
        self._room_id: Optional[int] = None

    @property
    def room_id(self) -> int:
        if not self._room_id:
            self._room_id = random.randint(100000, 999999)
        return self._room_id

    async def attach(self):
        await self.video_room.attach(self.session)

    async def create_room(self):
        await self.video_room.create_room(room_id=self.room_id)

    async def destroy_room(self) -> None:
        await self.video_room.destroy_room(self.room_id)

    async def add_participant(self, display_name: str, user_id: Optional[str] = None):
        participant_data = {
            'display_name': display_name,
            'room_id': self.room_id
        }
        if user_id:
            participant_data['id'] = user_id
        
        return await self.video_room.join(**participant_data)

    @staticmethod
    async def handle_event(evt: dict):
        await print("JANUS EVENT:", evt)

    @property
    async def participants(self) -> list:
        return await self.video_room.list_participants(self.room_id)

