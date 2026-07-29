import asyncio
import json
import logging

import aiohttp
from asgiref.sync import sync_to_async
from channels.generic.websocket import AsyncWebsocketConsumer
from constance import config as constance_config
from core.channel_groups import consultation_group, user_group
from core.consumers import TenantConsumerMixin
from django.conf import settings

logger = logging.getLogger(__name__)


class AppointmentTranscriptionConsumer(TenantConsumerMixin, AsyncWebsocketConsumer):
    """
    WebSocket consumer that receives raw audio from the browser,
    streams it to the whisper-live server, and broadcasts the
    resulting transcription text to all consultation participants
    via their user_{pk} channel groups.
    """

    # Give up only after whisper-live has been unreachable for a couple of minutes
    MAX_RECONNECT_ATTEMPTS = 8
    MAX_RECONNECT_DELAY = 30

    async def connect(self):
        self.user = self.scope.get("user")
        if not self.user or not self.user.is_authenticated:
            await self.close(code=4001)
            return

        if not await self._live_transcription_enabled():
            await self.close(code=4003)
            return

        self.appointment_pk = self.scope["url_route"]["kwargs"]["appointment_pk"]
        self.whisper_ws = None
        self.whisper_session = None
        self.whisper_task = None
        self.broadcast_worker = None
        self.broadcast_queue = None
        self.save_task = None
        self.consultation = None
        self.speaker_name = None
        self.user_pks = set()
        self.speaker_label = None
        self.language = "en"
        # Set by _stop_transcription so the supervisor does not reconnect on the way out
        self.stopping = False
        # whisper segment index -> last text emitted, -> pending transcript line,
        # and the ids already written to the database
        self.segment_texts = {}
        self.transcript_segments = {}
        self.saved_segment_ids = set()
        # Namespaces segment timestamps, which restart at 0 on each whisper session
        self.session_seq = 0

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
            ws = self.whisper_ws
            if ws is not None and not ws.closed:
                try:
                    await ws.send_bytes(bytes_data)
                except Exception as e:
                    logger.warning(
                        f"Failed to forward audio chunk to whisper-live "
                        f"(appointment={self.appointment_pk}): {type(e).__name__}: {e}"
                    )
            else:
                # Expected while reconnecting: audio spoken during the gap is lost
                logger.debug(
                    f"Audio chunk dropped, no whisper-live session "
                    f"(appointment={self.appointment_pk})"
                )
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
        if self.whisper_task is not None:
            return

        self.speaker_label = speaker_label
        self.language = language
        self.stopping = False
        # A new whisper session numbers its segments from 0 again — flush and drop the
        # previous mapping so restarting does not overwrite lines already transcribed.
        if self.transcript_segments:
            await self._save_transcript(flush_all=True)
        self.segment_texts = {}
        self.transcript_segments = {}
        self.saved_segment_ids = set()
        self.session_seq = 0

        self.consultation = await self._get_consultation()
        # Resolved once: hitting the DB on every segment refinement would stall the
        # read loop long enough for whisper to drop us on a keepalive ping timeout.
        self.speaker_name = await self._get_speaker_name()
        self.user_pks = await self._get_user_pks()

        self.broadcast_queue = asyncio.Queue()
        self.whisper_task = asyncio.create_task(self._transcription_loop())
        self.broadcast_worker = asyncio.create_task(self._broadcast_worker())
        self.save_task = asyncio.create_task(self._periodic_save())

        logger.info(
            f"Transcription started: appointment={self.appointment_pk} language={language}"
        )

    async def _transcription_loop(self):
        """
        Keep a whisper session alive for as long as the browser is streaming audio.

        whisper-live drops clients on its own (--max_connection_time, restarts,
        network hiccups), so a single connection is not enough for a consultation:
        reconnect until the client explicitly stops.
        """
        failures = 0
        try:
            while not self.stopping:
                if not await self._connect_whisper():
                    failures += 1
                    if failures >= self.MAX_RECONNECT_ATTEMPTS:
                        await self._send_json({
                            "event": "transcription_error",
                            "message": "Failed to connect to transcription server",
                            "url": settings.WHISPER_LIVE_URL,
                        })
                        return
                    # Exponential backoff, capped — a whisper restart takes a while
                    delay = min(2 ** failures, self.MAX_RECONNECT_DELAY)
                    logger.info(
                        f"Retrying whisper-live in {delay}s "
                        f"(appointment={self.appointment_pk} attempt={failures})"
                    )
                    await asyncio.sleep(delay)
                    continue

                failures = 0
                await self._read_segments()

                if self.stopping:
                    return

                # Segment timestamps restart at 0 in the next session; bump the counter
                # they are namespaced with so refinements cannot rewrite older lines.
                self.session_seq += 1
                self.segment_texts = {}
                await self._cleanup_whisper_session()
                logger.info(
                    f"whisper-live session ended, reconnecting "
                    f"(appointment={self.appointment_pk} session={self.session_seq})"
                )
                await self._send_json({"event": "transcription_reconnecting"})
                await asyncio.sleep(1)
        except asyncio.CancelledError:
            raise
        except Exception as e:
            logger.error(
                f"Transcription loop crashed (appointment={self.appointment_pk}): "
                f"{type(e).__name__}: {e}",
                exc_info=True,
            )

    async def _connect_whisper(self):
        """Open a whisper-live session and send its initial config. False on failure."""
        whisper_url = settings.WHISPER_LIVE_URL

        # Sent as a header rather than ?token= so the key stays out of access logs
        headers = {}
        if settings.WHISPER_LIVE_API_KEY:
            headers["Authorization"] = f"Bearer {settings.WHISPER_LIVE_API_KEY}"

        try:
            # sock_connect/connect only bound the handshake, not the (long-lived) WS itself
            self.whisper_session = aiohttp.ClientSession(
                timeout=aiohttp.ClientTimeout(connect=10, sock_connect=10)
            )
            self.whisper_ws = await self.whisper_session.ws_connect(
                whisper_url, compress=0, headers=headers
            )

            # Use speaker_label in uid so each remote participant gets its own session
            uid_suffix = self.speaker_label or "self"
            whisper_model = await self._whisper_model()
            # whisper-live expects this as the first message
            await self.whisper_ws.send_str(json.dumps({
                "uid": f"appointment_{self.appointment_pk}_{self.user.pk}_{uid_suffix}",
                "language": self.language,
                "task": "transcribe",
                "model": whisper_model,
                "use_vad": True,
            }))
        except Exception as e:
            # Log the full traceback and the exception class: aiohttp raises very
            # different errors depending on the cause (DNS, refused, TLS, 4xx...).
            logger.error(
                f"Failed to connect to whisper-live at {whisper_url}: "
                f"{type(e).__name__}: {e}",
                exc_info=True,
            )
            await self._cleanup_whisper_session()
            return False

        logger.info(f"Connected to whisper-live at {whisper_url}")
        await self._send_json({"event": "transcription_connected"})
        return True

    async def _read_segments(self):
        """Read segments from the current whisper session until it closes."""
        try:
            async for msg in self.whisper_ws:
                if msg.type == aiohttp.WSMsgType.TEXT:
                    try:
                        data = json.loads(msg.data)
                        segments = data.get("segments", [])
                        if not segments:
                            continue
                        # whisper-live returns ALL segments accumulated since session start,
                        # and keeps REFINING the trailing ones as more audio arrives: a long
                        # sentence first shows up truncated, then grows. Tracking a plain
                        # "already seen N segments" counter would freeze each segment on its
                        # first partial hypothesis, so we compare text per index instead and
                        # re-emit whenever a segment changed.
                        for index, seg in enumerate(segments):
                            text = seg.get("text", "").strip()
                            if not text or not self.consultation:
                                continue
                            # whisper only sends a sliding window of its last segments,
                            # so positional indexes shift and cannot identify a line.
                            # Its start timestamp is stable; prefix it with the session
                            # counter since timestamps restart at 0 after a reconnect.
                            segment_id = f"{self.session_seq}:{seg.get('start', index)}"
                            if self.segment_texts.get(segment_id) == text:
                                continue
                            self.segment_texts[segment_id] = text
                            # Hand off to a worker: aiohttp only answers whisper's
                            # keepalive pings from inside this receive loop, so the
                            # loop must never await anything slow.
                            self.broadcast_queue.put_nowait(
                                (segment_id, text, bool(seg.get("completed", False)))
                            )
                    except (json.JSONDecodeError, KeyError) as e:
                        logger.warning(
                            f"Unexpected payload from whisper-live: {type(e).__name__}: {e} "
                            f"— raw={msg.data[:500]}"
                        )
                elif msg.type in (aiohttp.WSMsgType.CLOSED, aiohttp.WSMsgType.ERROR):
                    logger.warning(
                        f"whisper-live closed the connection "
                        f"(appointment={self.appointment_pk} type={msg.type.name} "
                        f"close_code={self.whisper_ws.close_code} "
                        f"exception={self.whisper_ws.exception()})"
                    )
                    break
        except asyncio.CancelledError:
            raise
        except Exception as e:
            logger.error(
                f"Transcription receive loop crashed "
                f"(appointment={self.appointment_pk}): {type(e).__name__}: {e}",
                exc_info=True,
            )

    async def _broadcast_worker(self):
        """Drain the queue produced by the whisper read loop and fan out to participants."""
        try:
            while True:
                segment_id, text, is_final = await self.broadcast_queue.get()

                # Whisper refines a segment several times per second; if the channel
                # layer falls behind, only the newest text of a segment matters.
                while not self.broadcast_queue.empty():
                    next_segment_id, next_text, next_is_final = self.broadcast_queue.get_nowait()
                    if next_segment_id != segment_id:
                        await self._broadcast_transcription(text, segment_id, is_final)
                    segment_id, text, is_final = next_segment_id, next_text, next_is_final

                await self._broadcast_transcription(text, segment_id, is_final)
        except asyncio.CancelledError:
            pass
        except Exception as e:
            logger.error(
                f"Broadcast worker crashed (appointment={self.appointment_pk}): "
                f"{type(e).__name__}: {e}",
                exc_info=True,
            )

    async def _periodic_save(self):
        """Save transcript to database every 30 seconds."""
        try:
            while True:
                await asyncio.sleep(30)
                if self.transcript_segments:
                    await self._save_transcript()
        except asyncio.CancelledError:
            pass

    async def _broadcast_transcription(self, text: str, segment_id: int, is_final: bool):
        """Send the transcript to all consultation participants via their user WS."""
        from django.utils import timezone

        # A segment is emitted several times as whisper refines it. Key the pending
        # transcript by segment id so a refinement rewrites its line instead of
        # appending a truncated duplicate.
        line = self.transcript_segments.get(segment_id)
        if segment_id in self.saved_segment_ids:
            # Already written to the database — re-adding it would duplicate the line.
            pass
        elif line is not None:
            line["text"] = text
            line["is_final"] = is_final
        else:
            self.transcript_segments[segment_id] = {
                "timestamp": timezone.now().isoformat(),
                "speaker": self.speaker_name,
                "speaker_id": self.user.pk,
                "text": text,
                "is_final": is_final,
            }

        event = {
            "type": "transcription",
            "appointment_id": int(self.appointment_pk),
            "text": text,
            "speaker_id": self.user.pk,
            "segment_id": segment_id,
            "is_final": is_final,
        }
        if self.speaker_label:
            event["speaker_label"] = self.speaker_label
        for user_pk in self.user_pks:
            await self.channel_layer.group_send(
                user_group(user_pk, self.schema_name), event
            )

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

    async def _send_json(self, payload):
        """Notify the browser that opened this consumer; harmless if it already left."""
        try:
            await self.send(text_data=json.dumps(payload))
        except Exception:
            pass

    async def _stop_transcription(self):
        self.stopping = True

        if self.whisper_task:
            self.whisper_task.cancel()
            try:
                await self.whisper_task
            except asyncio.CancelledError:
                pass
            self.whisper_task = None

        # Release the whisper session first: the flushing below must not be able to
        # leave a dangling connection behind if it raises.
        await self._cleanup_whisper_session()

        if self.broadcast_worker:
            self.broadcast_worker.cancel()
            try:
                await self.broadcast_worker
            except asyncio.CancelledError:
                pass
            self.broadcast_worker = None

            # Both producer and consumer are stopped: flush what is left, otherwise
            # the final wording of the closing sentence never reaches the transcript.
            while self.broadcast_queue and not self.broadcast_queue.empty():
                segment_id, text, is_final = self.broadcast_queue.get_nowait()
                await self._broadcast_transcription(text, segment_id, is_final)

        if hasattr(self, 'save_task') and self.save_task:
            self.save_task.cancel()
            try:
                await self.save_task
            except asyncio.CancelledError:
                pass
            self.save_task = None

        # Save accumulated transcript to the database
        if self.transcript_segments:
            await self._save_transcript(flush_all=True)

        logger.info(f"Transcription stopped: appointment={self.appointment_pk}")

    @sync_to_async
    def _live_transcription_enabled(self):
        with self.tenant_scope():
            return constance_config.enable_live_transcription

    @sync_to_async
    def _whisper_model(self):
        with self.tenant_scope():
            return constance_config.whisper_model

    def _settled_segment_ids(self, flush_all: bool):
        """
        Segment ids that will not change any more, so they can be persisted.

        Whisper only revises its trailing segment, so everything inserted before the
        latest one is settled. Flushing a segment still being refined would freeze it
        on a truncated version, since it is dropped from transcript_segments after.

        Ids are timestamp strings, so rely on dict insertion order — which is
        chronological — rather than sorting them.
        """
        ids = list(self.transcript_segments)
        if flush_all or not ids:
            return ids
        last_id = ids[-1]
        return [
            sid
            for sid in ids
            if sid != last_id or self.transcript_segments[sid]["is_final"]
        ]

    @sync_to_async
    def _save_transcript(self, flush_all=False):
        """Persist the settled transcript segments to the appointment."""
        from consultations.models import Appointment
        import json as json_module

        segment_ids = self._settled_segment_ids(flush_all)
        if not segment_ids:
            return

        with self.tenant_scope():
            try:
                appointment = Appointment.objects.get(pk=self.appointment_pk)
            except Appointment.DoesNotExist:
                return

            # Merge with existing transcript data if any
            existing = []
            if appointment.transcript:
                try:
                    existing = json_module.loads(appointment.transcript)
                except (json_module.JSONDecodeError, TypeError):
                    existing = []

            for segment_id in segment_ids:
                line = self.transcript_segments.pop(segment_id)
                line.pop("is_final", None)
                existing.append(line)
                self.saved_segment_ids.add(segment_id)

            appointment.transcript = json_module.dumps(existing, ensure_ascii=False)
            appointment.save(update_fields=["transcript"])
            logger.info(f"Transcript saved for appointment {self.appointment_pk}: {len(existing)} lines")

    @sync_to_async
    def _get_speaker_name(self):
        """Get the display name of the current user."""
        return self.user.name or self.user.email or str(self.user.pk)

    @sync_to_async
    def _get_consultation(self):
        from consultations.models import Appointment
        with self.tenant_scope():
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
        with self.tenant_scope():
            return get_users_to_notification_consultation(self.consultation)


class ConsultationConsumer(TenantConsumerMixin, AsyncWebsocketConsumer):
    """WebSocket consumer for consultation-level real-time events."""

    async def connect(self):
        user = self.scope.get("user")
        if not user or not user.is_authenticated:
            await self.close(code=4001)
            return

        self.consultation_pk = self.scope["url_route"]["kwargs"]["consultation_pk"]
        await self.channel_layer.group_add(
            consultation_group(self.consultation_pk, self.schema_name),
            self.channel_name,
        )
        await self.accept()

    async def disconnect(self, close_code):
        await self.channel_layer.group_discard(
            consultation_group(self.consultation_pk, self.schema_name),
            self.channel_name,
        )
