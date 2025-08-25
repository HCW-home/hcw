# comments in English
from channels.generic.websocket import AsyncJsonWebsocketConsumer
from .serializers import ConsultationSerializer

from mediaserver.manager.janus import Janus
from mediaserver.models import Server, Turn
from mediaserver.serializers import TurnIceServerSerializer

from asgiref.sync import sync_to_async
from django.conf import settings
import asyncio

# Module-level dictionaries to track active rooms and their sessions
# This ensures rooms persist across connections but are properly managed
_active_rooms = {}  # consultation_id -> room_id
_room_locks = {}
_active_sessions = {}  # consultation_id -> {'session': janus_instance, 'count': connection_count}

class ConsultationConsumer(AsyncJsonWebsocketConsumer):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.janus = None  # Publisher handle
        self.subscriber_handles = {}  # feed_id -> subscriber_janus_instance
        self.is_publisher = False
        self.publisher_id = None
        self.uses_shared_session = False
        
    async def connect(self):
        consultation_id = self.scope["url_route"]["kwargs"]["consultation_pk"]
        self.consultation_id = consultation_id
        room_group_name = f"consultation_{consultation_id}"
        await self.channel_layer.group_add(room_group_name, self.channel_name)

        await self.accept()
        
        # Send comprehensive ICE server configuration to frontend
        # Based on Janus Gateway best practices for reliable connectivity

        ice_servers = {
            "iceServers": await get_turn(),
            "iceCandidatePoolSize": 10,
            "bundlePolicy": "max-bundle",
            "rtcpMuxPolicy": "require",
            "iceTransportPolicy": "all"  # Allow both UDP and TCP
        }

        await self.send_json({"type": "ice_config", "data": ice_servers})
        
        await self._get_or_create_shared_session()
        
        # Auto-create or join existing room for this consultation
        await self._ensure_room_exists()


    async def receive_json(self, content, **kwargs):
        t = content.get("type")
        data = content.get("data") or {}

        if t == "create_room":
            # Room already created/ensured in connect, just return the room ID
            room_id = _active_rooms.get(self.consultation_id)
            if room_id:
                self.janus._room_id = room_id
                await self.send_json({"type": "room_created", "room_id": room_id})
            else:
                await self._ensure_room_exists()

        elif t == "join":
            display = data.get("display_name", "Guest")
            
            # Check if already joined as publisher
            if self.is_publisher:
                print(f"Already joined as publisher with ID: {self.publisher_id}")
                # Send current participants list
                try:
                    plist = await self.janus.list_participants()
                    await self.send_json({"type": "joined", "publisher_id": self.publisher_id})
                    await self.send_json({"type": "participants", "data": plist})
                except Exception as e:
                    print(f"Error getting participants for already joined user: {e}")
                    await self.send_json({"type": "participants", "data": []})
                return
            
            # Ensure room exists before joining
            await self._ensure_room_exists()
            
            try:
                # First ensure room exists by listing participants (this will create it if needed)
                try:
                    existing_participants = await self.janus.list_participants()
                    print(f"Room {self.janus.room_id} exists with participants: {existing_participants}")
                except Exception as room_check_error:
                    print(f"Room {self.janus.room_id} may not exist, trying to create: {room_check_error}")
                    try:
                        await self.janus.create_room()
                        print(f"Successfully created room {self.janus.room_id}")
                    except Exception as create_error:
                        print(f"Room creation failed but may already exist: {create_error}")
                
                join_result = await self.janus.join(display)
                print(f"Join result for {display}: {join_result}")
                
                # Check if join was successful - handle different response formats
                if join_result and isinstance(join_result, dict):
                    if join_result.get("videoroom") == "joined":
                        self.is_publisher = True
                        self.publisher_id = join_result.get("id")
                        print(f"Successfully joined as publisher with ID: {self.publisher_id}")
                    elif join_result.get("error_code") == 425:  # Already in as publisher
                        print(f"Already in room as publisher, handling gracefully")
                        self.is_publisher = True
                        # Try to get our publisher ID from participants list
                        try:
                            plist = await self.janus.list_participants()
                            for p in plist:
                                if p.get("display") == display:
                                    self.publisher_id = p.get("id")
                                    break
                        except Exception as pe:
                            print(f"Error getting participants after join: {pe}")
                elif join_result == False:
                    print(f"Join returned False - likely room doesn't exist or other error")
                    raise Exception("Join failed - room may not exist")
                
                # Get participants to check current room state
                try:
                    plist = await self.janus.list_participants()
                    print(f"Participants after {display} joined: {plist}")
                    await self.send_json({"type": "participants", "data": plist})
                except Exception as pe:
                    print(f"Error getting participants after successful join: {pe}")
                    await self.send_json({"type": "participants", "data": []})
                
            except Exception as e:
                print(f"Error joining room: {e}")
                await self.send_json({"type": "error", "message": f"Failed to join room: {str(e)}"})

        elif t == "publish":
            # Client sends its local SDP offer to publish media
            try:
                # Send the publish request - our monkey-patch will intercept and forward the JSEP answer
                result = await self.janus.publish(jsep_offer=data["jsep"])
                print(f"Publish result: {result}")
                
                # The JSEP answer should have been intercepted and forwarded by our monkey-patch
                
                # After publishing, broadcast participant update to everyone
                room_group_name = f"consultation_{self.consultation_id}"
                await self.channel_layer.group_send(room_group_name, {
                    "type": "trigger_participant_refresh"
                })
            except Exception as e:
                print(f"Error during publish: {e}")
                await self.send_json({"type": "error", "message": f"Failed to publish: {str(e)}"})

        elif t == "subscribe":
            # Subscribe to a remote feed (publisher id) using separate subscriber handle
            try:
                feed_id = int(data["feed_id"])
                print(f"Creating subscriber handle for feed {feed_id}")
                
                # Create a separate subscriber handle for this feed
                server = await self._get_server()
                
                async def subscriber_event_handler(evt: dict):
                    # Handle intercepted JSEP from subscriber
                    if evt.get('intercepted'):
                        if evt.get('jsep') and evt['jsep'].get('type') == 'answer':
                            print(f"🎯 Intercepted subscriber JSEP answer for feed {feed_id}")
                            await self.send_json({
                                "type": "janus_event", 
                                "payload": {
                                    'janus': 'event',
                                    'jsep': evt['jsep'],
                                    'feed_id': feed_id
                                }
                            })
                        return
                    # Mark events from this subscriber handle
                    evt['feed_id'] = feed_id
                    await self.send_json({"type": "janus_event", "payload": evt})
                
                subscriber_janus = Janus(server, on_event=subscriber_event_handler)
                await subscriber_janus.attach()
                
                # Use the same room as the publisher
                subscriber_janus._room_id = self.janus.room_id
                
                # Subscribe to the specific feed
                result = await subscriber_janus.subscribe(feed_id=feed_id)
                print(f"Subscriber handle created for feed {feed_id}: {result}")
                
                # Store the subscriber handle
                self.subscriber_handles[feed_id] = subscriber_janus
                
            except Exception as e:
                print(f"Error creating subscriber handle for feed {feed_id}: {e}")
                await self.send_json({
                    "type": "error", 
                    "message": f"Failed to subscribe to feed {feed_id}: {str(e)}"
                })

        elif t == "start":
            # Relay the client's SDP answer to Janus to start receiving
            # This is for subscriber handles - need to determine which handle to use
            feed_id = data.get("feed_id")
            if feed_id and feed_id in self.subscriber_handles:
                print(f"Starting subscriber for feed {feed_id}")
                await self.subscriber_handles[feed_id].start(jsep_answer=data["jsep"])
            else:
                print("Starting on publisher handle (fallback)")
                await self.janus.start(jsep_answer=data["jsep"])

        elif t == "trickle":
            # Relay ICE candidate (or None at end-of-candidates)
            # Need to determine if this is for publisher or subscriber handle
            feed_id = data.get("feed_id")
            if feed_id and feed_id in self.subscriber_handles:
                print(f"Trickling ICE for subscriber feed {feed_id}")
                await self.subscriber_handles[feed_id].trickle(candidate=data.get("candidate"))
            else:
                print("Trickling ICE for publisher handle")
                await self.janus.trickle(candidate=data.get("candidate"))

        elif t == "participants":
            try:
                plist = await self.janus.list_participants()
                print(plist)
                await self.send_json({"type": "participants", "data": plist})
                # Also broadcast to all participants in the room
                consultation_id = self.scope["url_route"]["kwargs"]["consultation_pk"]
                room_group_name = f"consultation_{consultation_id}"
                await self.channel_layer.group_send(room_group_name, {
                    "type": "participants_update",
                    "participants": plist
                })
            except Exception as e:
                print(f"Error getting participants: {e}")
                # Try to ensure room exists and retry
                await self._ensure_room_exists()
                try:
                    plist = await self.janus.list_participants()
                    await self.send_json({"type": "participants", "data": plist})
                except Exception as e2:
                    print(f"Failed to get participants after room recreation: {e2}")
                    await self.send_json({"type": "participants", "data": []})

        else:
            print(content)


    async def disconnect(self, code):
        if hasattr(self, "janus") and self.janus:
            try:
                # Leave the room if we're a publisher
                if self.is_publisher:
                    await self.janus.leave()
                    self.is_publisher = False
                    self.publisher_id = None
            except Exception as e:
                print(f"Error during disconnect: {e}")
        
        # Clean up subscriber handles
        for feed_id, subscriber_handle in self.subscriber_handles.items():
            try:
                await subscriber_handle.close()
                print(f"Closed subscriber handle for feed {feed_id}")
            except Exception as e:
                print(f"Error closing subscriber handle for feed {feed_id}: {e}")
        self.subscriber_handles.clear()
        
        # Handle shared session cleanup
        await self._cleanup_shared_session()
        
        # Remove from channel group
        room_group_name = f"consultation_{self.consultation_id}"
        await self.channel_layer.group_discard(room_group_name, self.channel_name)

    async def _get_server(self):
        # Fetch any configured Janus server entry
        return await Server.objects.afirst()
    
    async def _get_or_create_shared_session(self):
        """Get or create a shared Janus session for this consultation"""
        global _active_sessions, _room_locks
        
        # Create lock for this consultation if it doesn't exist
        if self.consultation_id not in _room_locks:
            _room_locks[self.consultation_id] = asyncio.Lock()
        
        async with _room_locks[self.consultation_id]:
            if self.consultation_id not in _active_sessions:
                # Create new shared session
                server = await self._get_server()
                
                async def on_evt(evt: dict):
                    # Broadcast event to all participants in the consultation
                    print(f"📡 on_evt callback triggered with: {evt}")
                    
                    # Handle intercepted JSEP answers from our monkey-patch
                    if evt.get('intercepted'):
                        if evt.get('jsep') and evt['jsep'].get('type') == 'answer':
                            print(f"🎯 Intercepted JSEP answer, forwarding to frontend")
                            # Send directly to all connections in the room
                            room_group_name = f"consultation_{self.consultation_id}"
                            await self.channel_layer.group_send(room_group_name, {
                                "type": "janus_event_broadcast", 
                                "event": {
                                    'janus': 'event',
                                    'jsep': evt['jsep']
                                }
                            })
                        return  # Don't broadcast intercepted events further
                    
                    if evt.get('jsep'):
                        print(f"🔔 JSEP event detected in callback: {evt['jsep']['type']}")
                    
                    room_group_name = f"consultation_{self.consultation_id}"
                    await self.channel_layer.group_send(room_group_name, {
                        "type": "janus_event_broadcast", 
                        "event": evt
                    })
                
                janus_instance = Janus(server, on_event=on_evt)
                await janus_instance.attach()
                
                _active_sessions[self.consultation_id] = {
                    'session': janus_instance,
                    'count': 0
                }
                print(f"Created shared Janus session for consultation {self.consultation_id}")
            
            # Use the shared session
            self.janus = _active_sessions[self.consultation_id]['session']
            _active_sessions[self.consultation_id]['count'] += 1
            self.uses_shared_session = True
            
            print(f"Using shared session for consultation {self.consultation_id}, connection count: {_active_sessions[self.consultation_id]['count']}")
    
    async def _cleanup_shared_session(self):
        """Clean up shared session when connection disconnects"""
        global _active_sessions, _room_locks
        
        if not self.uses_shared_session or self.consultation_id not in _active_sessions:
            return
        
        if self.consultation_id not in _room_locks:
            _room_locks[self.consultation_id] = asyncio.Lock()
        
        async with _room_locks[self.consultation_id]:
            if self.consultation_id in _active_sessions:
                _active_sessions[self.consultation_id]['count'] -= 1
                print(f"Decremented connection count for consultation {self.consultation_id}: {_active_sessions[self.consultation_id]['count']}")
                
                # If no more connections, close the session
                if _active_sessions[self.consultation_id]['count'] <= 0:
                    try:
                        session_instance = _active_sessions[self.consultation_id]['session']
                        await session_instance.close()
                        print(f"Closed shared Janus session for consultation {self.consultation_id}")
                    except Exception as e:
                        print(f"Error closing shared session: {e}")
                    finally:
                        del _active_sessions[self.consultation_id]
                        # Also clean up the room reference
                        if self.consultation_id in _active_rooms:
                            del _active_rooms[self.consultation_id]

    async def _ensure_room_exists(self):
        global _active_rooms, _room_locks
        
        # Create lock for this consultation if it doesn't exist
        if self.consultation_id not in _room_locks:
            _room_locks[self.consultation_id] = asyncio.Lock()
        
        # Use lock to ensure only one client creates the room
        async with _room_locks[self.consultation_id]:
            # For testing, always use room 121554 to match the demo
            target_room_id = 121554
            
            # Check if room already exists for this consultation
            if self.consultation_id not in _active_rooms:
                # Set the room ID and store it
                self.janus._room_id = target_room_id
                _active_rooms[self.consultation_id] = target_room_id
                print(f"Using Janus room {target_room_id} for consultation {self.consultation_id} (demo room)")
                
                # Try to create the room (it might already exist from the demo)
                try:
                    await self.janus.create_room()
                    print(f"Created Janus room {target_room_id}")
                except Exception as e:
                    print(f"Room {target_room_id} might already exist (from demo): {e}")
                    # This is expected if the demo room already exists
            else:
                # Use existing room ID
                existing_room_id = _active_rooms[self.consultation_id]
                self.janus._room_id = existing_room_id
                print(f"Using existing Janus room {existing_room_id} for consultation {self.consultation_id}")
                
                # Test if room actually exists on Janus server
                try:
                    await self.janus.list_participants()
                    print(f"Confirmed room {existing_room_id} exists on Janus server")
                except Exception as e:
                    print(f"Room {existing_room_id} doesn't exist on Janus server: {e}")
                    # Reset to target room
                    self.janus._room_id = target_room_id
                    _active_rooms[self.consultation_id] = target_room_id
        
        # Send room created message to this client
        await self.send_json({"type": "room_created", "room_id": self.janus.room_id})

    async def participants_update(self, event):
        # Handler for participants_update group message
        await self.send_json({
            "type": "participants",
            "data": event["participants"]
        })

    async def janus_event_broadcast(self, event):
        # Handler for broadcasting Janus events to all participants
        evt = event["event"]
        print(f"📤 Broadcasting Janus event to frontend: {evt}")
        if evt.get('jsep'):
            print(f"🚀 Broadcasting JSEP event to frontend: {evt['jsep']['type']}")
        
        await self.send_json({
            "type": "janus_event", 
            "payload": evt
        })
        
        # Also check for specific videoroom events to trigger participant refresh
        evt = event["event"]
        if evt.get("plugindata", {}).get("data", {}).get("videoroom") == "event":
            data = evt["plugindata"]["data"]
            if "publishers" in data or "unpublished" in data:
                # Trigger participant refresh for this client
                try:
                    plist = await self.janus.list_participants()
                    await self.send_json({"type": "participants", "data": plist})
                except Exception as e:
                    print(f"Error refreshing participants after event: {e}")

    async def trigger_participant_refresh(self, event):
        # Trigger participants list refresh for this client
        try:
            plist = await self.janus.list_participants()
            print(f"Triggered participant refresh: {plist}")
            await self.send_json({"type": "participants", "data": plist})
        except Exception as e:
            print(f"Error getting participants during refresh: {e}")
            # Room might not exist, try to recreate it
            await self._ensure_room_exists()
            try:
                plist = await self.janus.list_participants()
                await self.send_json({"type": "participants", "data": plist})
            except Exception as e2:
                print(f"Failed to get participants after room recreation: {e2}")
                await self.send_json({"type": "participants", "data": []})


@sync_to_async
def get_consultation(consultation_id):
    from .models import Consultation
    consultation = Consultation.objects.get(pk=consultation_id)
    return ConsultationSerializer(consultation).data,

@sync_to_async
def get_turn():
    turns = Turn.objects.all()
    return TurnIceServerSerializer(turns, many=True).data