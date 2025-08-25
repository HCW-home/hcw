# comments in English
from typing import Optional, Awaitable, Callable
from janus_client import JanusSession, JanusVideoRoomPlugin
from janus_client.message_transaction import MessageTransaction
import random
import asyncio
import json


class VideoRoomPlugin(JanusVideoRoomPlugin):
    def __init__(self, on_event: Optional[Callable[[dict], Awaitable[None]]] = None):
        super().__init__()
        self._on_event = on_event

    async def on_receive(self, evt: dict):
        # Forward every plugin event (including JSEP offers) to your callback
        print(f"🔧 VideoRoomPlugin.on_receive called with: {evt}")
        if evt.get('jsep'):
            print(f"🔧 JSEP detected in on_receive: {evt['jsep']['type']}")
        
        if self._on_event:
            await self._on_event(evt)
        
        # Also call the parent on_receive to ensure proper handling
        await super().on_receive(evt)


class Janus:
    def __init__(self, server, on_event: Optional[Callable[[dict], Awaitable[None]]] = None):
        self.on_event = on_event
        self.session = JanusSession(
            base_url=server.url, api_secret=server.api_secret)
        self.video_room = VideoRoomPlugin(on_event=on_event)
        self._room_id: Optional[int] = None
        self._jsep_events = {}  # Store JSEP events by transaction ID
        self._pending_jsep_answers = {}  # Store pending JSEP answers by request type
        
        # Monkey-patch the session's send method to intercept responses
        self._original_session_send = self.session.send
        self.session.send = self._patched_session_send
        
        # Also patch the video_room's send method
        self._original_video_room_send = self.video_room.send
        self.video_room.send = self._patched_video_room_send

    @property
    def room_id(self) -> int:
        if not self._room_id:
            # For testing, use the same room as the demo
            self._room_id = 121554  # Match the demo room
            # self._room_id = random.randint(100000, 999999)  # Original random room
        return self._room_id

    async def _patched_session_send(self, message, handle_id=None):
        """Monkey-patched send method to intercept JSEP answers"""
        # Call the original send method
        message_transaction = await self._original_session_send(message, handle_id)
        
        # Wrap the get method to capture JSEP
        original_get = message_transaction.get
        async def patched_get(matcher=None, timeout=None):
            result = await original_get(matcher, timeout)
            
            # Check if this response contains a JSEP answer
            if isinstance(result, dict) and result.get('jsep'):
                jsep = result['jsep']
                print(f"🎯 INTERCEPTED JSEP in session send: {jsep.get('type')}")
                
                # Forward to our event handler if it's an answer
                if jsep.get('type') == 'answer' and self.on_event:
                    await self.on_event({
                        'janus': 'event',
                        'jsep': jsep,
                        'intercepted': True
                    })
            
            return result
        
        message_transaction.get = patched_get
        return message_transaction
    
    async def _patched_video_room_send(self, message):
        """Monkey-patched video room send to intercept JSEP answers"""
        # Check if this is a configure request (publish)
        is_configure = (isinstance(message, dict) and 
                       message.get('body', {}).get('request') == 'configure')
        
        # Call the original send method
        message_transaction = await self._original_video_room_send(message)
        
        if is_configure:
            # Wrap the get method to capture JSEP answer
            original_get = message_transaction.get
            async def patched_get(matcher=None, timeout=None):
                result = await original_get(matcher, timeout)
                
                # Check if this response contains a JSEP answer
                if isinstance(result, dict) and result.get('jsep'):
                    jsep = result['jsep']
                    print(f"🎯 INTERCEPTED JSEP in video_room send (configure): {jsep.get('type')}")
                    
                    # Store for later retrieval
                    self._pending_jsep_answers['configure'] = jsep
                    
                    # Forward to our event handler
                    if jsep.get('type') == 'answer' and self.on_event:
                        await self.on_event({
                            'janus': 'event',
                            'jsep': jsep,
                            'intercepted': True,
                            'request': 'configure'
                        })
                
                return result
            
            message_transaction.get = patched_get
        
        return message_transaction
    
    async def attach(self):
        await self.video_room.attach(self.session)

    async def create_room(self):
        # Create room with correct janus_client parameters
        try:
            print(f"Creating Janus room {self.room_id}")
            # Use minimal parameters that janus_client supports
            result = await self.video_room.create_room(room_id=self.room_id)
            print(f"Room {self.room_id} creation result: {result}")
            return result
        except Exception as e:
            print(f"Error creating room {self.room_id}: {e}")
            # Check if room already exists
            if "already exists" in str(e).lower():
                print(f"Room {self.room_id} already exists, continuing...")
                return {"videoroom": "created"}
            else:
                raise e

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
        
        # Send the message
        message_transaction = await self.video_room.send(message)
        print(f"Publish configure request sent")
        
        # Wait for the response with JSEP answer
        # The library receives both ACK and EVENT, we need the EVENT with JSEP
        jsep_answer = None
        
        # Get all messages for this transaction
        try:
            # First message is usually ACK
            ack = await message_transaction.get(matcher={"janus": "ack"}, timeout=5)
            print(f"First response (ACK): {ack}")
            
            # Second message should be the event with JSEP
            # Use a lambda matcher to accept any message
            event = await message_transaction.get(matcher=lambda msg: True, timeout=5)
            print(f"Second response (EVENT): {event.get('janus') if isinstance(event, dict) else event}")
            
            # Check if we got JSEP in the event
            if isinstance(event, dict) and event.get('jsep'):
                jsep_answer = event['jsep']
                print(f"🎯 Successfully extracted JSEP answer: {jsep_answer.get('type')}")
                # Forward the JSEP answer to the frontend
                if self.on_event:
                    await self.on_event({
                        'janus': 'event',
                        'jsep': jsep_answer
                    })
            else:
                print(f"⚠️ No JSEP answer found in event response")
                print(f"Full event: {event}")
        except asyncio.TimeoutError:
            print(f"⚠️ Timeout waiting for responses")
        except Exception as e:
            print(f"❌ Error during publish: {e}")
            import traceback
            traceback.print_exc()
        
        # Complete the transaction
        await message_transaction.done()
        
        return message_transaction

    async def subscribe(self, feed_id: int):
        # Create a subscriber; Janus will reply with a JSEP offer (to forward to the client)
        # According to Janus docs, this should trigger an offer from Janus that we forward to the client
        print(f"Subscribing to feed {feed_id} in room {self.room_id}")
        message = {
            "janus": "message",
            "body": {
                "request": "join",
                "ptype": "subscriber", 
                "room": self.room_id,
                "feed": feed_id,
                "private_id": feed_id  # Optional: helps with identification
            }
        }
        message_transaction = await self.video_room.send(message)
        print(f"Subscribe result for feed {feed_id}: {message_transaction}")
        
        # Get the response with JSEP offer for subscriber
        try:
            # First get ACK
            ack = await message_transaction.get(matcher={"janus": "ack"}, timeout=5)
            print(f"Subscribe ACK: {ack}")
            
            # Then get event with JSEP offer
            event = await message_transaction.get(matcher=lambda msg: True, timeout=5)
            if isinstance(event, dict) and event.get('jsep'):
                print(f"🎯 Got JSEP offer for subscriber: {event['jsep'].get('type')}")
                # Forward to frontend
                if self.on_event:
                    await self.on_event(event)
        except Exception as e:
            print(f"Error getting subscribe response: {e}")
        
        await message_transaction.done()
        return message_transaction

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
        try:
            if candidate is None or (isinstance(candidate, dict) and candidate.get('candidate') is None):
                # End of candidates - check if the janus_client supports end-of-candidates
                print("Sending end-of-candidates signal to Janus")
                try:
                    # Try the standard WebRTC way first
                    return await self.video_room.trickle(sdpMLineIndex=0, candidate=None)
                except Exception as e1:
                    print(f"Standard trickle failed: {e1}")
                    try:
                        # Try with empty string
                        return await self.video_room.trickle(sdpMLineIndex=0, candidate="")
                    except Exception as e2:
                        print(f"Empty string trickle failed: {e2}")
                        # Just skip end-of-candidates if it's not supported
                        print("Skipping end-of-candidates signal (not critical)")
                        return None
            else:
                # Send the ICE candidate
                sdp_m_line_index = candidate.get('sdpMLineIndex', candidate.get('sdpMid', 0))
                candidate_str = candidate.get('candidate', '')
                
                # Validate candidate string
                if not candidate_str or candidate_str == "null":
                    print("Invalid candidate string, skipping")
                    return None
                    
                print(f"Sending ICE candidate to Janus: sdpMLineIndex={sdp_m_line_index}, candidate={candidate_str[:50]}...")
                return await self.video_room.trickle(sdpMLineIndex=sdp_m_line_index, candidate=candidate_str)
        except Exception as e:
            print(f"Error sending ICE candidate to Janus: {e}")
            return None

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
