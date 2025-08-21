# comments in English
from typing import Optional, Awaitable, Callable
from janus_client import JanusSession, JanusVideoRoomPlugin
import random


class VideoRoomPlugin(JanusVideoRoomPlugin):
    def __init__(self, on_event: Optional[Callable[[dict], Awaitable[None]]] = None):
        super().__init__()
        self._on_event = on_event

    async def on_receive(self, evt: dict):
        # Forward every plugin event (including JSEP offers) to your callback
        if self._on_event:
            await self._on_event(evt)


class Janus:
    def __init__(self, server, on_event: Optional[Callable[[dict], Awaitable[None]]] = None):
        self.session = JanusSession(
            base_url=server.url, api_secret=server.api_secret)
        self.video_room = VideoRoomPlugin(on_event=on_event)
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

    async def join(self, display_name: str):
        # Join as publisher (no JSEP yet)
        return await self.video_room.join(room_id=self.room_id, display_name=display_name)

    async def publish(self, jsep_offer: dict, audio: bool = True, video: bool = True):
        # For publishers: send your local SDP offer to Janus
        return await self.video_room.publish(room_id=self.room_id, jsep=jsep_offer,
                                             audio=audio, video=video)

    async def subscribe(self, feed_id: int):
        # Create a subscriber; Janus will reply with a JSEP offer (to forward to the client)
        return await True
        # return await self.video_room.subscribe_and_start(room_id=self.room_id, streams=[{"feed": feed_id}])

    async def start(self, jsep_answer: dict):
        # <-- This is the important relay for subscribers
        return await self.video_room.subscribe_and_start(room_id=self.room_id, jsep=jsep_answer)

    async def trickle(self, candidate: dict | None):
        # Relay ICE candidate(s) from client to Janus. Use None to signal end-of-candidates.
        return await self.video_room.trickle(candidate)

    async def list_participants(self) -> list:
        return await self.video_room.list_participants(self.room_id)

    async def destroy_room(self):
        await self.video_room.destroy_room(self.room_id)

    async def close(self):
        try:
            await self.video_room.leave()
        finally:
            await self.video_room.destroy()
            await self.session.destroy()
