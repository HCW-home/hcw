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
        message = {
            "janus": "message",
            "body": {
                "request": "configure",
                "audio": audio,
                "video": video
            }
        }
        if jsep_offer:
            message["jsep"] = jsep_offer
        return await self.video_room.send(message)

    async def subscribe(self, feed_id: int):
        # Create a subscriber; Janus will reply with a JSEP offer (to forward to the client)
        message = {
            "janus": "message",
            "body": {
                "request": "join",
                "ptype": "subscriber",
                "room": self.room_id,
                "feed": feed_id
            }
        }
        return await self.video_room.send(message)

    async def start(self, jsep_answer: dict):
        # <-- This is the important relay for subscribers
        message = {
            "janus": "message",
            "body": {
                "request": "start"
            }
        }
        if jsep_answer:
            message["jsep"] = jsep_answer
        return await self.video_room.send(message)

    async def trickle(self, candidate: dict | None):
        # Relay ICE candidate(s) from client to Janus. Use None to signal end-of-candidates.
        if candidate is None:
            # End of candidates - send empty candidate
            return await self.video_room.trickle(sdpMLineIndex=0, candidate="")
        else:
            # Send the ICE candidate
            sdp_m_line_index = candidate.get('sdpMLineIndex', 0)
            candidate_str = candidate.get('candidate', '')
            return await self.video_room.trickle(sdpMLineIndex=sdp_m_line_index, candidate=candidate_str)

    async def list_participants(self) -> list:
        return await self.video_room.list_participants(self.room_id)

    async def leave(self):
        await self.video_room.leave()

    async def destroy_room(self):
        await self.video_room.destroy_room(self.room_id)

    async def close(self):
        try:
            await self.video_room.destroy()
            await self.session.destroy()
        except Exception as e:
            print(f"Error closing Janus connection: {e}")
