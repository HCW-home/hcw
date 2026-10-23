"""Live transcription: whose line it is, which session records it, where it lands.

Every participant with captions on transcribes their own microphone and the
tracks of the others, so the same speaker is usually heard on several sessions.
"""

import json
import shutil
import tempfile
import uuid
from unittest.mock import AsyncMock, patch

from asgiref.sync import async_to_sync
from django.core.cache import cache
from django.db.models.signals import post_save
from django.test import override_settings
from django.utils import timezone
from django_tenants.test.cases import TenantTestCase

from consultations.consumers import AppointmentTranscriptionConsumer
from consultations.models import (
    Appointment,
    AppointmentStatus,
    Consultation,
    Message,
    Participant,
    Type,
)
from consultations.tasks import post_transcript
from consultations.utils import TRANSCRIPT_POST_DELAY, transcription_active_key
from users.models import User

LOCMEM_CACHES = {
    "default": {
        "BACKEND": "django.core.cache.backends.locmem.LocMemCache",
        "LOCATION": "transcription-tests",
        "KEY_FUNCTION": "django_tenants.cache.make_key",
        "REVERSE_KEY_FUNCTION": "django_tenants.cache.reverse_key",
    },
    "shared": {
        "BACKEND": "django.core.cache.backends.locmem.LocMemCache",
        "LOCATION": "transcription-tests-shared",
    },
}
IN_MEMORY_CHANNELS = {
    "default": {"BACKEND": "channels.layers.InMemoryChannelLayer"}
}


def _run(method, *args, **kwargs):
    """Await a consumer coroutine from a synchronous test."""

    async def run():
        return await method(*args, **kwargs)

    return async_to_sync(run)()


@override_settings(CACHES=LOCMEM_CACHES, CHANNEL_LAYERS=IN_MEMORY_CHANNELS)
class _TranscriptionBase(TenantTestCase):
    def setUp(self):
        cache.clear()
        self.doctor = User.objects.create_user(
            email="doctor@example.com",
            first_name="Ada",
            last_name="Lovelace",
            is_practitioner=True,
        )
        self.patient = User.objects.create_user(
            email="patient@example.com", first_name="Alan", last_name="Turing"
        )
        self.consultation = Consultation.objects.create(
            title="Follow-up", created_by=self.doctor, owned_by=self.doctor
        )
        self.appointment = Appointment.objects.create(
            created_by=self.doctor,
            consultation=self.consultation,
            scheduled_at=timezone.now(),
            status=AppointmentStatus.scheduled,
            type=Type.online,
        )
        for user in (self.doctor, self.patient):
            Participant.objects.create(
                appointment=self.appointment, user=user, is_active=True
            )

    def _identity(self, user):
        """LiveKit identity of `user`, as the browsers send it in speaker_label."""
        return f"{self.tenant.schema_name}:{user.pk}"

    def _session(self, user, speaker=None):
        """A consumer as connect() and a started session leave it.

        `user` streams the audio, `speaker` is heard on it: their own
        microphone when left out, a capture of another participant otherwise.
        """
        speaker = speaker or user
        consumer = AppointmentTranscriptionConsumer()
        consumer.scope = {"user": user, "tenant": self.tenant}
        consumer.channel_layer = AsyncMock()
        consumer.user = user
        consumer.appointment_pk = str(self.appointment.pk)
        consumer.whisper_ws = None
        consumer.whisper_session = None
        consumer.whisper_task = None
        consumer.broadcast_worker = None
        consumer.broadcast_queue = None
        consumer.save_task = None
        consumer.heartbeat_task = None
        consumer.speaker_label = None if speaker == user else self._identity(speaker)
        consumer.speaker_pk = speaker.pk
        consumer.speaker_name = speaker.name
        consumer.is_writer = True
        consumer.lease_token = uuid.uuid4().hex
        consumer.user_pks = {self.doctor.pk, self.patient.pk}
        consumer.transcript_segments = {}
        consumer.saved_segment_ids = set()
        return consumer


class SpeakerTests(_TranscriptionBase):
    """A line belongs to the participant heard, not to the user streaming it."""

    def _resolve(self, speaker_label, user=None):
        consumer = self._session(user or self.doctor)
        return _run(consumer._resolve_speaker, speaker_label)

    def test_own_microphone_is_the_streaming_user(self):
        self.assertEqual(self._resolve(None), (self.doctor.pk, self.doctor.name))

    def test_captured_track_is_the_participant_heard(self):
        self.assertEqual(
            self._resolve(self._identity(self.patient)),
            (self.patient.pk, self.patient.name),
        )

    def test_identity_without_tenant_prefix(self):
        self.assertEqual(
            self._resolve(str(self.patient.pk)), (self.patient.pk, self.patient.name)
        )

    def test_someone_outside_the_call_is_refused(self):
        stranger = User.objects.create_user(email="stranger@example.com")

        self.assertIsNone(self._resolve(self._identity(stranger)))

    def test_removed_participant_is_refused(self):
        Participant.objects.filter(user=self.patient).update(is_active=False)

        self.assertIsNone(self._resolve(self._identity(self.patient)))

    def test_identity_from_another_tenant_is_refused(self):
        self.assertIsNone(self._resolve(f"elsewhere:{self.patient.pk}"))

    def test_garbage_is_refused(self):
        self.assertIsNone(self._resolve("not-an-identity"))

    def test_only_practitioners_capture_the_others(self):
        """Otherwise a patient could stream their voice under the doctor's name."""
        self.assertIsNone(self._resolve(self._identity(self.doctor), user=self.patient))

    def test_patient_transcribes_their_own_microphone(self):
        self.assertEqual(
            self._resolve(None, user=self.patient), (self.patient.pk, self.patient.name)
        )


class SingleSourceTests(_TranscriptionBase):
    """A speaker heard on several sessions is captioned and recorded by one."""

    def test_a_second_session_hearing_the_speaker_stays_out(self):
        first = self._session(self.doctor, speaker=self.patient)
        second = self._session(self.doctor, speaker=self.patient)

        self.assertTrue(_run(first._renew_claims))
        self.assertFalse(_run(second._renew_claims))
        self.assertTrue(_run(first._renew_claims))

    def test_own_microphone_takes_the_speaker_over(self):
        capture = self._session(self.patient, speaker=self.doctor)
        own = self._session(self.doctor)

        self.assertTrue(_run(capture._renew_claims))
        self.assertTrue(_run(own._renew_claims, take_over=True))
        self.assertFalse(_run(capture._renew_claims))

    def test_released_speaker_goes_to_the_next_session(self):
        first = self._session(self.doctor, speaker=self.patient)
        second = self._session(self.doctor, speaker=self.patient)
        _run(first._renew_claims)

        _run(first._release_claims)

        self.assertTrue(_run(second._renew_claims))

    def test_speakers_are_claimed_independently(self):
        self.assertTrue(_run(self._session(self.doctor)._renew_claims))
        self.assertTrue(
            _run(self._session(self.doctor, speaker=self.patient)._renew_claims)
        )

    def test_a_running_session_flags_the_call(self):
        _run(self._session(self.doctor)._renew_claims)

        self.assertTrue(cache.get(transcription_active_key(self.appointment.pk)))


class RecordingTests(_TranscriptionBase):
    """What a session writes to the transcript and broadcasts."""

    def test_captured_line_is_stored_under_the_participant_heard(self):
        capture = self._session(self.doctor, speaker=self.patient)

        _run(capture._broadcast_transcription, "Bonjour docteur", "0:0.000", True)
        _run(capture._save_transcript, flush_all=True)

        self.appointment.refresh_from_db()
        [line] = json.loads(self.appointment.transcript)
        self.assertEqual(line["speaker_id"], self.patient.pk)
        self.assertEqual(line["speaker"], self.patient.name)
        self.assertEqual(line["text"], "Bonjour docteur")
        event = capture.channel_layer.group_send.await_args.args[1]
        self.assertEqual(event["speaker_id"], self.patient.pk)
        self.assertEqual(event["speaker_label"], self._identity(self.patient))

    def test_session_not_holding_the_speaker_stays_silent(self):
        capture = self._session(self.doctor, speaker=self.patient)
        capture.is_writer = False

        _run(capture._broadcast_transcription, "Bonjour docteur", "0:0.000", True)

        self.assertEqual(capture.transcript_segments, {})
        capture.channel_layer.group_send.assert_not_awaited()

    def test_line_started_while_holding_the_speaker_keeps_being_refined(self):
        capture = self._session(self.doctor, speaker=self.patient)
        _run(capture._broadcast_transcription, "Bonjour", "0:0.000", False)
        capture.is_writer = False

        _run(capture._broadcast_transcription, "Bonjour docteur", "0:0.000", True)

        self.assertEqual(capture.transcript_segments["0:0.000"]["text"], "Bonjour docteur")

    def test_sessions_append_to_the_same_transcript(self):
        own = self._session(self.doctor)
        capture = self._session(self.doctor, speaker=self.patient)

        _run(own._broadcast_transcription, "Bonjour", "0:0.000", True)
        _run(own._save_transcript, flush_all=True)
        _run(capture._broadcast_transcription, "Bonjour docteur", "0:0.000", True)
        _run(capture._save_transcript, flush_all=True)

        self.appointment.refresh_from_db()
        self.assertEqual(
            [line["text"] for line in json.loads(self.appointment.transcript)],
            ["Bonjour", "Bonjour docteur"],
        )

    def test_saving_leaves_the_appointment_signals_alone(self):
        """A save would broadcast the appointment and requeue its invitations."""
        saved = []

        def receiver(sender, instance, **kwargs):
            saved.append(instance.pk)

        post_save.connect(receiver, sender=Appointment)
        self.addCleanup(post_save.disconnect, receiver, sender=Appointment)
        own = self._session(self.doctor)

        _run(own._broadcast_transcription, "Bonjour", "0:0.000", True)
        _run(own._save_transcript, flush_all=True)

        self.assertEqual(saved, [])

    def test_stopping_hands_the_speaker_over_and_schedules_the_post(self):
        first = self._session(self.doctor, speaker=self.patient)
        second = self._session(self.doctor, speaker=self.patient)
        _run(first._renew_claims)

        with patch("consultations.tasks.post_transcript.apply_async") as apply_async:
            _run(first._stop_transcription)

        apply_async.assert_called_once_with(
            args=[self.appointment.pk], countdown=TRANSCRIPT_POST_DELAY
        )
        self.assertTrue(_run(second._renew_claims))

    def test_stop_then_disconnect_schedules_a_single_post(self):
        own = self._session(self.doctor)

        with patch("consultations.tasks.post_transcript.apply_async") as apply_async:
            _run(own._stop_transcription)
            _run(own._stop_transcription)

        apply_async.assert_called_once()


class PostTranscriptTests(_TranscriptionBase):
    """The transcript lands in the chat once nobody transcribes the call."""

    def setUp(self):
        super().setUp()
        # Local files in a scratch directory, whatever storage the environment
        # configures: S3 would both reach out to the bucket and overwrite files
        media_root = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, media_root, ignore_errors=True)
        storage_override = override_settings(
            MEDIA_ROOT=media_root,
            STORAGES={
                "default": {
                    "BACKEND": "django.core.files.storage.FileSystemStorage"
                },
                "staticfiles": {
                    "BACKEND": "django.contrib.staticfiles.storage.StaticFilesStorage"
                },
            },
        )
        storage_override.enable()
        self.addCleanup(storage_override.disable)

    def _add_lines(self, *lines):
        """Append (speaker, text) lines as the transcription sessions write them."""
        self.appointment.refresh_from_db()
        transcript = json.loads(self.appointment.transcript or "[]")
        transcript += [
            {
                "timestamp": timezone.now().isoformat(),
                "speaker": speaker.name,
                "speaker_id": speaker.pk,
                "text": text,
            }
            for speaker, text in lines
        ]
        Appointment.objects.filter(pk=self.appointment.pk).update(
            transcript=json.dumps(transcript)
        )

    def _posts(self):
        return Message.objects.filter(
            consultation=self.consultation, event="transcript_available"
        ).order_by("id")

    def _content(self, message):
        with message.attachment.open("rb") as attachment:
            return attachment.read().decode("utf-8")

    def test_lines_are_posted_as_a_text_file(self):
        self._add_lines(
            (self.doctor, "Bonjour"), (self.patient, "Bonjour docteur")
        )

        post_transcript(self.appointment.pk)

        [message] = self._posts()
        self.assertEqual(message.created_by, self.doctor)
        self.assertTrue(
            message.attachment.name.endswith(
                f"transcript_appointment_{self.appointment.pk}_lines_1-2.txt"
            )
        )
        content = self._content(message)
        self.assertIn(f"] {self.doctor.name}: Bonjour\n", content)
        self.assertIn(f"] {self.patient.name}: Bonjour docteur\n", content)

    def test_nothing_is_posted_while_a_session_runs(self):
        self._add_lines((self.doctor, "Bonjour"))
        cache.set(transcription_active_key(self.appointment.pk), True, 15)

        post_transcript(self.appointment.pk)

        self.assertFalse(self._posts().exists())

    def test_lines_are_posted_once(self):
        self._add_lines((self.doctor, "Bonjour"))

        post_transcript(self.appointment.pk)
        post_transcript(self.appointment.pk)

        self.assertEqual(self._posts().count(), 1)

    def test_later_lines_get_a_message_of_their_own(self):
        self._add_lines((self.doctor, "Bonjour"))
        post_transcript(self.appointment.pk)
        self._add_lines((self.patient, "Au revoir"))

        post_transcript(self.appointment.pk)

        first, second = self._posts()
        self.assertNotIn("Au revoir", self._content(first))
        self.assertIn("Au revoir", self._content(second))
        self.assertNotIn("Bonjour", self._content(second))

    def test_empty_transcript_posts_nothing(self):
        post_transcript(self.appointment.pk)

        self.assertFalse(self._posts().exists())
