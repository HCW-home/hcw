# myapp/consumers.py
# comments in English
import asyncio
import json
from .serializers import ConsultationSerializer
from asgiref.sync import sync_to_async
from channels.generic.websocket import AsyncJsonWebsocketConsumer

class ConsultationConsumer(AsyncJsonWebsocketConsumer):

    async def connect(self):
        consultation_id = self.scope["url_route"]["kwargs"]["consultation_pk"]
        room_group_name = f"consultation_{consultation_id}"

        await self.channel_layer.group_add(room_group_name, self.channel_name)

        await self.accept()

        await self.consultation_update({"consultation_id": consultation_id})

    async def consultation_update(self, data):
        consultation_id = data['consultation_id']
        await self.send_json({
            "type": "consultation_update",
            "data": await get_consultation(consultation_id)
        })

    async def disconnect(self, close_code):
        if hasattr(self, "_stop"):
            self._stop.set()
        if hasattr(self, "_task"):
            try:
                await asyncio.wait_for(self._task, timeout=2)
            except Exception:
                pass

    async def receive_json(self, content, **kwargs):
        """
        Called when a message is received from the WebSocket client.
        `content` is already parsed JSON.
        """
        message_type = content.get("type")

        print(content)

        if message_type == "ping":
            await self.send_json({"type": "pong"})
        
        if message_type == "join":
            pass
        

@sync_to_async
def get_consultation(consultation_id):
    from .models import Consultation
    consultation = Consultation.objects.get(pk=consultation_id)
    return ConsultationSerializer(consultation).data,
