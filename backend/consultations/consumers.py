# comments in English
from channels.generic.websocket import AsyncJsonWebsocketConsumer
from .serializers import ConsultationSerializer
from mediaserver.manager.janus import Janus
from mediaserver.models import Server
from asgiref.sync import sync_to_async

class ConsultationConsumer(AsyncJsonWebsocketConsumer):
    async def connect(self):
        consultation_id = self.scope["url_route"]["kwargs"]["consultation_pk"]
        room_group_name = f"consultation_{consultation_id}"
        await self.channel_layer.group_add(room_group_name, self.channel_name)

        await self.accept()
        server = await self._get_server()

        async def on_evt(evt: dict):
            await self.send_json({"type": "janus_event", "payload": evt})

        self.janus = Janus(server, on_event=on_evt)
        await self.janus.attach()


    async def receive_json(self, content, **kwargs):
        t = content.get("type")
        data = content.get("data") or {}

        if t == "create_room":
            await self.janus.create_room()
            await self.send_json({"type": "room_created", "room_id": self.janus.room_id})

        elif t == "join":
            display = data.get("display_name", "Guest")
            await self.janus.join(display)

        elif t == "publish":
            # Client sends its local SDP offer to publish media
            await self.janus.publish(jsep_offer=data["jsep"])

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
            await self.send_json({"type": "participants", "data": plist})

        else:
            print(content)


    async def disconnect(self, code):
        if hasattr(self, "janus"):
            await self.janus.destroy_room()
            await self.janus.close()

    async def _get_server(self):
        # Fetch any configured Janus server entry
        return await Server.objects.afirst()


@sync_to_async
def get_consultation(consultation_id):
    from .models import Consultation
    consultation = Consultation.objects.get(pk=consultation_id)
    return ConsultationSerializer(consultation).data,
