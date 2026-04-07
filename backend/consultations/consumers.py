import asyncio
import json
import logging

import aiohttp
from asgiref.sync import sync_to_async
from channels.generic.websocket import AsyncWebsocketConsumer
from constance import config as constance_config
from django.conf import settings

logger = logging.getLogger(__name__)


class AppointmentTranscriptionConsumer(AsyncWebsocketConsumer):
    """
    WebSocket consumer that receives raw audio from the browser,
    streams it to the whisper-live server, and broadcasts the
    resulting transcription text to all consultation participants
    via their user_{pk} channel groups.
    """

    async def connect(self):
        self.user = self.scope.get("user")
        if not self.user or not self.user.is_authenticated:
            await self.close(code=4001)
            return

        if not await sync_to_async(lambda: constance_config.enable_subtitles)():
            await self.close(code=4003)
            return

        self.appointment_pk = self.scope["url_route"]["kwargs"]["appointment_pk"]
        self.whisper_ws = None
        self.whisper_session = None
        self.whisper_task = None
        self.consultation = None
        self.speaker_label = None

        await self.accept()
        logger.info(
            f"Transcription WS connected: appointment={self.appointment_pk} user={self.user.pk}"
        )

    async def disconnect(self, close_code):
        await self._stop_transcription()
        logger.info(
            f"Transcription WS disconnected: appointment={self.appointment_pk} code={close_code}"
        )

    async def receive(self, text_data=None, bytes_data=None):
        if bytes_data:
            # Forward raw audio chunks to whisper-live
            if self.whisper_ws is not None:
                try:
                    await self.whisper_ws.send_bytes(bytes_data)
                except Exception:
                    pass
        elif text_data:
            try:
                data = json.loads(text_data)
            except json.JSONDecodeError:
                return

            msg_type = data.get("type")
            if msg_type == "start_transcription":
                await self._start_transcription(data.get("language", "en"), data.get("speaker_label"))
            elif msg_type == "stop_transcription":
                await self._stop_transcription()

    async def _start_transcription(self, language: str, speaker_label: str = None):
        if self.whisper_ws is not None:
            return

        self.speaker_label = speaker_label

        whisper_url = getattr(settings, "WHISPER_LIVE_URL", "ws://localhost:9090")

        try:
            self.whisper_session = aiohttp.ClientSession()
            self.whisper_ws = await self.whisper_session.ws_connect(whisper_url)
        except Exception as e:
            logger.error(f"Failed to connect to whisper-live at {whisper_url}: {e}")
            await self._cleanup_whisper_session()
            await self.send(text_data=json.dumps({
                "event": "transcription_error",
                "message": "Failed to connect to transcription server",
            }))
            return

        # Use speaker_label in uid so each remote participant gets its own whisper session
        uid_suffix = speaker_label or "self"
        whisper_model = await sync_to_async(lambda: constance_config.whisper_model)()
        # Send initial config — whisper-live expects this as the first message
        config = {
            "uid": f"appointment_{self.appointment_pk}_{self.user.pk}_{uid_suffix}",
            "language": language,
            "task": "transcribe",
            "model": whisper_model,
            "use_vad": True,
        }
        await self.whisper_ws.send_str(json.dumps(config))

        self.consultation = await self._get_consultation()
        self.whisper_task = asyncio.create_task(self._receive_transcription())

        logger.info(
            f"Transcription started: appointment={self.appointment_pk} language={language}"
        )

    async def _receive_transcription(self):
        """Continuously read transcription segments from whisper-live and broadcast them."""
        try:
            async for msg in self.whisper_ws:
                if msg.type == aiohttp.WSMsgType.TEXT:
                    try:
                        data = json.loads(msg.data)
                        segments = data.get("segments", [])
                        if not segments:
                            continue
                        # whisper-live returns all segments accumulated since session
                        # start — only the last one is the newly transcribed text.
                        text = segments[-1].get("text", "").strip()
                        if text and self.consultation:
                            await self._broadcast_transcription(text)
                    except (json.JSONDecodeError, KeyError):
                        pass
                elif msg.type in (aiohttp.WSMsgType.CLOSED, aiohttp.WSMsgType.ERROR):
                    break
        except Exception as e:
            logger.debug(f"Transcription receive loop ended: {e}")

    async def _broadcast_transcription(self, text: str):
        """Send the transcript to all consultation participants via their user WS."""
        user_pks = await self._get_user_pks()
        event = {
            "type": "transcription",
            "appointment_id": int(self.appointment_pk),
            "text": text,
            "speaker_id": self.user.pk,
        }
        if self.speaker_label:
            event["speaker_label"] = self.speaker_label
        for user_pk in user_pks:
            await self.channel_layer.group_send(f"user_{user_pk}", event)

    async def _cleanup_whisper_session(self):
        """Close whisper WebSocket and aiohttp session."""
        if self.whisper_ws is not None:
            try:
                await self.whisper_ws.close()
            except Exception:
                pass
            self.whisper_ws = None

        if self.whisper_session is not None:
            try:
                await self.whisper_session.close()
            except Exception:
                pass
            self.whisper_session = None

    async def _stop_transcription(self):
        if self.whisper_task:
            self.whisper_task.cancel()
            try:
                await self.whisper_task
            except asyncio.CancelledError:
                pass
            self.whisper_task = None

        await self._cleanup_whisper_session()

        logger.info(f"Transcription stopped: appointment={self.appointment_pk}")

    @sync_to_async
    def _get_consultation(self):
        from consultations.models import Appointment
        try:
            return Appointment.objects.select_related("consultation").get(
                pk=self.appointment_pk
            ).consultation
        except Appointment.DoesNotExist:
            return None

    @sync_to_async
    def _get_user_pks(self):
        from consultations.signals import get_users_to_notification_consultation
        if not self.consultation:
            return set()
        return get_users_to_notification_consultation(self.consultation)


class ConsultationConsumer(AsyncWebsocketConsumer):
    """WebSocket consumer for consultation-level real-time events."""

    async def connect(self):
        user = self.scope.get("user")
        if not user or not user.is_authenticated:
            await self.close(code=4001)
            return

        self.consultation_pk = self.scope["url_route"]["kwargs"]["consultation_pk"]
        await self.channel_layer.group_add(
            f"consultation_{self.consultation_pk}", self.channel_name
        )
        await self.accept()

    async def disconnect(self, close_code):
        await self.channel_layer.group_discard(
            f"consultation_{self.consultation_pk}", self.channel_name
        )
