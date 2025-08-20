from typing import Optional
from ..models import Server
from janus_client import JanusSession, JanusVideoRoomPlugin
import random

class Janus:

    def __init__(self, server: Server):
        self.server = server
        self.session = JanusSession(
            base_url=self.server.url, api_secret=self.server.api_secret)
        self.video_room = JanusVideoRoomPlugin()
        self._room_id: Optional[int] = None

    @property
    def room_id(self) -> int:
        if not self._room_id:
            self._room_id = random.randint(100000, 999999)
        return self._room_id

    async def attach(self):
        await self.video_room.attach(self.session)

    async def create_room(self):
        print(await self.video_room.create_room(room_id=self.room_id))

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

    @property
    async def participants(self) -> list:
        return await self.video_room.list_participants(self.room_id)

