# comments in English
from channels.generic.websocket import AsyncJsonWebsocketConsumer
from .serializers import ConsultationSerializer
from mediaserver.manager.janus import Janus
from mediaserver.models import Server
from asgiref.sync import sync_to_async

class ConsultationConsumer(AsyncJsonWebsocketConsumer):
    # Class-level dictionary to track rooms per consultation
    consultation_rooms = {}

    async def connect(self):
        consultation_id = self.scope["url_route"]["kwargs"]["consultation_pk"]
        self.consultation_id = consultation_id
        room_group_name = f"consultation_{consultation_id}"
        await self.channel_layer.group_add(room_group_name, self.channel_name)

        await self.accept()
        server = await self._get_server()

        async def on_evt(evt: dict):
            # Forward event to this client
            await self.send_json({"type": "janus_event", "payload": evt})
            
            # Also broadcast publisher events to all participants in the room
            if evt.get("plugindata", {}).get("data", {}).get("videoroom") == "event":
                data = evt["plugindata"]["data"]
                if "publishers" in data or "unpublished" in data:
                    room_group_name = f"consultation_{self.consultation_id}"
                    await self.channel_layer.group_send(room_group_name, {
                        "type": "janus_event_broadcast",
                        "event": evt
                    })

        self.janus = Janus(server, on_event=on_evt)
        await self.janus.attach()
        
        # Auto-create or join existing room for this consultation
        await self._ensure_room_exists()


    async def receive_json(self, content, **kwargs):
        t = content.get("type")
        data = content.get("data") or {}

        if t == "create_room":
            # Room already created/ensured in connect, just return the room ID
            room_id = self.consultation_rooms.get(self.consultation_id)
            if room_id:
                self.janus._room_id = room_id
                await self.send_json({"type": "room_created", "room_id": room_id})
            else:
                await self._ensure_room_exists()

        elif t == "join":
            display = data.get("display_name", "Guest")
            join_result = await self.janus.join(display)
            print(f"Join result for {display}: {join_result}")
            
            # Also immediately get participants to check current room state
            plist = await self.janus.list_participants()
            print(f"Participants after {display} joined: {plist}")
            await self.send_json({"type": "participants", "data": plist})

        elif t == "publish":
            # Client sends its local SDP offer to publish media
            await self.janus.publish(jsep_offer=data["jsep"])
            
            # After publishing, broadcast participant update to everyone
            room_group_name = f"consultation_{self.consultation_id}"
            await self.channel_layer.group_send(room_group_name, {
                "type": "trigger_participant_refresh"
            })

        elif t == "subscribe":
            # Subscribe to a remote feed (publisher id)
            await self.janus.subscribe(feed_id=int(data["feed_id"]))

        elif t == "start":
            # <-- Relay the client's SDP answer to Janus to start receiving
            await self.janus.start(jsep_answer=data["jsep"])

        elif t == "trickle":
            # Relay ICE candidate (or None at end-of-candidates)
            await self.janus.trickle(candidate=data.get("candidate"))

        elif t == "participants":
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

        else:
            print(content)


    async def disconnect(self, code):
        if hasattr(self, "janus"):
            # Only leave the room, don't destroy it (other participants might still be there)
            await self.janus.leave()
            await self.janus.close()

    async def _get_server(self):
        # Fetch any configured Janus server entry
        return await Server.objects.afirst()

    async def _ensure_room_exists(self):
        # Check if room already exists for this consultation
        if self.consultation_id not in self.consultation_rooms:
            # Create room and store the room ID
            await self.janus.create_room()
            self.consultation_rooms[self.consultation_id] = self.janus.room_id
            print(f"Created new Janus room {self.janus.room_id} for consultation {self.consultation_id}")
        else:
            # Use existing room ID
            existing_room_id = self.consultation_rooms[self.consultation_id]
            self.janus._room_id = existing_room_id
            print(f"Using existing Janus room {existing_room_id} for consultation {self.consultation_id}")
        
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
        await self.send_json({
            "type": "janus_event", 
            "payload": event["event"]
        })

    async def trigger_participant_refresh(self, event):
        # Trigger participants list refresh for this client
        plist = await self.janus.list_participants()
        print(f"Triggered participant refresh: {plist}")
        await self.send_json({"type": "participants", "data": plist})


@sync_to_async
def get_consultation(consultation_id):
    from .models import Consultation
    consultation = Consultation.objects.get(pk=consultation_id)
    return ConsultationSerializer(consultation).data,
