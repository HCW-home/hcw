from datetime import datetime, timedelta
from unittest.mock import patch
from zoneinfo import ZoneInfo

from django_tenants.test.cases import TenantTestCase
from django.utils import timezone
from messaging.models import Message
from users.models import Organisation, User

from .models import Appointment, AppointmentStatus, Consultation, Participant, Reason, Request
from .serializers import RequestSerializer
from .tasks import handle_invites

# Create your tests here.


class AppointmentTest(TenantTestCase):
    def setUp(self):
        """Préparation des données pour chaque test"""
        self.patient = User.objects.create_user(
            email="patient@example.com"
        )
        self.practitioner = User.objects.create_user(
            email="practitioner@example.com"
        )

        self.consultation = Consultation.objects.create(
            beneficiary=self.patient,
            title="Fiever",
            created_by=self.practitioner,
        )

        self.appointment = Appointment.objects.create(
            created_by=self.practitioner,
            consultation=self.consultation,
            scheduled_at=timezone.now() + timedelta(days=1),
        )

        self.participant1 = Participant.objects.create(
            appointment=self.appointment,
            user=self.practitioner,
        )

        self.participant2 = Participant.objects.create(
            appointment=self.appointment,
            user=self.patient,
        )

    def test_consultation_creation(self):
        """Vérifie que la consultation est créée correctement"""

        self.assertEqual(self.consultation.title, "Fiever")
        self.assertEqual(self.consultation.beneficiary, self.patient)

    def test_invite_sent(self):
        self.assertFalse(self.participant1.is_notified)
        self.assertFalse(self.participant2.is_notified)

        self.appointment.status = AppointmentStatus.scheduled
        self.appointment.save()

        handle_invites(self.appointment.pk)

        self.assertEqual(Message.objects.count(), 2)

        for message in Message.objects.all():
            self.assertTrue(message.template_is_valid)


class ConsultationTemporaryBeneficiaryTest(TenantTestCase):
    """The consultation beneficiary can be provided as an external contact
    (temporary_beneficiary): mapped to an existing user by email/phone or
    created as a temporary user, both on creation and on assignment."""

    def setUp(self):
        from rest_framework.test import APIClient

        self.practitioner = User.objects.create_user(
            email="doc@example.com", is_practitioner=True
        )
        self.patient = User.objects.create_user(email="pat@example.com")
        self.client = APIClient()
        self.client.force_authenticate(user=self.practitioner)

    def test_create_consultation_with_temporary_beneficiary(self):
        from django.urls import reverse

        response = self.client.post(
            reverse("consultation-list"),
            {
                "title": "Follow-up",
                "temporary_beneficiary": {
                    "first_name": "John",
                    "last_name": "Smith",
                    "email": "john.smith@example.com",
                    "communication_method": "email",
                },
            },
            format="json",
        )
        self.assertEqual(response.status_code, 201, response.data)
        consultation = Consultation.objects.get(pk=response.data["id"])
        self.assertEqual(consultation.beneficiary.email, "john.smith@example.com")
        self.assertTrue(consultation.beneficiary.temporary)
        self.assertEqual(consultation.beneficiary.created_by, self.practitioner)

    def test_create_consultation_temporary_beneficiary_maps_existing_user(self):
        from django.urls import reverse

        response = self.client.post(
            reverse("consultation-list"),
            {
                "title": "Follow-up",
                "temporary_beneficiary": {
                    "email": self.patient.email,
                    "communication_method": "email",
                },
            },
            format="json",
        )
        self.assertEqual(response.status_code, 201, response.data)
        consultation = Consultation.objects.get(pk=response.data["id"])
        # Mapped onto the existing account, not duplicated.
        self.assertEqual(consultation.beneficiary, self.patient)
        self.assertEqual(User.objects.filter(email=self.patient.email).count(), 1)

    def test_assign_temporary_beneficiary_on_update(self):
        from django.urls import reverse

        consultation = Consultation.objects.create(
            title="Unassigned", created_by=self.practitioner
        )
        response = self.client.patch(
            reverse("consultation-detail", args=[consultation.id]),
            {
                "temporary_beneficiary": {
                    "first_name": "Jane",
                    "mobile_phone_number": "+41791234567",
                    "communication_method": "sms",
                }
            },
            format="json",
        )
        self.assertEqual(response.status_code, 200, response.data)
        consultation.refresh_from_db()
        self.assertEqual(
            consultation.beneficiary.mobile_phone_number, "+41791234567"
        )
        self.assertTrue(consultation.beneficiary.temporary)

    def test_explicit_beneficiary_id_wins_over_temporary(self):
        from django.urls import reverse

        response = self.client.post(
            reverse("consultation-list"),
            {
                "title": "Follow-up",
                "beneficiary_id": self.patient.id,
                "temporary_beneficiary": {
                    "email": "other@example.com",
                    "communication_method": "email",
                },
            },
            format="json",
        )
        self.assertEqual(response.status_code, 201, response.data)
        consultation = Consultation.objects.get(pk=response.data["id"])
        self.assertEqual(consultation.beneficiary, self.patient)
        self.assertFalse(User.objects.filter(email="other@example.com").exists())


class RequestTimezoneTest(TenantTestCase):
    """Test timezone handling in Request creation"""

    def setUp(self):
        """Setup test data"""
        self.organisation = Organisation.objects.create(name="Test Org")

        # Create patient with Paris timezone (UTC+1/UTC+2 depending on DST)
        self.patient = User.objects.create_user(
            email="patient@example.com",
                        timezone="Europe/Paris",
            main_organisation=self.organisation,
        )

        # Create practitioner
        self.practitioner = User.objects.create_user(
            email="practitioner@example.com",
                        timezone="UTC",
            main_organisation=self.organisation,
        )

        # Create reason for consultation request
        from users.models import Speciality
        self.speciality = Speciality.objects.create(name="General Medicine")
        self.reason = Reason.objects.create(
            name="Follow-up",
            speciality=self.speciality,
            is_active=True,
        )

    def test_naive_datetime_converted_to_user_timezone(self):
        """Test that naive datetime is correctly interpreted as user's timezone"""
        # Create a mock request object
        from rest_framework.test import APIRequestFactory
        factory = APIRequestFactory()
        request = factory.post("/api/requests/")
        request.user = self.patient

        # Create a naive datetime (2026-03-15 14:00:00 - no timezone)
        # This should be interpreted as 14:00 in the patient's timezone (Europe/Paris)
        naive_dt = datetime(2026, 3, 15, 14, 0, 0)

        # Prepare data for serializer
        data = {
            "expected_at": naive_dt,
            "reason_id": self.reason.id,
            "comment": "Test request",
        }

        # Create serializer with context
        serializer = RequestSerializer(data=data, context={"request": request})
        self.assertTrue(serializer.is_valid())

        # Validate expected_at
        validated_at = serializer.validated_data["expected_at"]

        # The datetime should now be timezone-aware in Europe/Paris timezone
        self.assertIsNotNone(validated_at.tzinfo)

        # Expected: 2026-03-15 14:00:00 Paris time
        # In UTC: 2026-03-15 13:00:00 (Paris is UTC+1 in March)
        paris_tz = ZoneInfo("Europe/Paris")
        expected_aware = datetime(2026, 3, 15, 14, 0, 0, tzinfo=paris_tz)

        # Compare the UTC times
        utc_tz = ZoneInfo('UTC')
        self.assertEqual(
            validated_at.astimezone(utc_tz),
            expected_aware.astimezone(utc_tz),
        )

    def test_utc_datetime_reinterpreted_as_user_timezone(self):
        """Test that UTC datetime is reinterpreted as user's timezone"""
        from rest_framework.test import APIRequestFactory
        factory = APIRequestFactory()
        request = factory.post("/api/requests/")
        request.user = self.patient

        # Create an aware datetime in UTC (14:00 UTC)
        # This should be reinterpreted as 14:00 in user's timezone (Paris)
        utc_tz = ZoneInfo('UTC')
        utc_dt = datetime(2026, 3, 15, 14, 0, 0, tzinfo=utc_tz)

        data = {
            "expected_at": utc_dt,
            "reason_id": self.reason.id,
            "comment": "Test request",
        }

        serializer = RequestSerializer(data=data, context={"request": request})
        self.assertTrue(serializer.is_valid())

        validated_at = serializer.validated_data["expected_at"]

        # The datetime should be reinterpreted as 14:00 in Paris timezone
        paris_tz = ZoneInfo("Europe/Paris")
        expected = datetime(2026, 3, 15, 14, 0, 0, tzinfo=paris_tz)

        # Convert both to UTC for comparison
        utc_tz = ZoneInfo('UTC')
        self.assertEqual(
            validated_at.astimezone(utc_tz),
            expected.astimezone(utc_tz),
        )


class AppointmentTimezoneTest(TenantTestCase):
    """Test timezone handling in Appointment assignment"""

    def setUp(self):
        """Setup test data"""
        self.organisation = Organisation.objects.create(name="Test Org")

        # Create patient in Paris timezone
        self.patient = User.objects.create_user(
            email="patient@example.com",
                        timezone="Europe/Paris",
            main_organisation=self.organisation,
        )

        # Create doctor in Tokyo timezone
        self.doctor = User.objects.create_user(
            email="doctor@example.com",
                        timezone="Asia/Tokyo",
            main_organisation=self.organisation,
            is_practitioner=True,
        )

        # Add speciality to doctor
        from users.models import Speciality
        self.speciality = Speciality.objects.create(name="General Medicine")
        self.doctor.specialities.add(self.speciality)

        # Create reason
        self.reason = Reason.objects.create(
            name="Follow-up",
            speciality=self.speciality,
            is_active=True,
            duration=30,
        )

        # Create booking slot for doctor (in doctor's timezone - Tokyo time)
        from .models import BookingSlot
        from datetime import time
        self.booking_slot = BookingSlot.objects.create(
            created_by=self.doctor,
            user=self.doctor,
            start_time=time(9, 0),  # 9 AM Tokyo time
            end_time=time(17, 0),   # 5 PM Tokyo time
            monday=True,
            tuesday=True,
            wednesday=True,
            thursday=True,
            friday=True,
            saturday=False,
            sunday=False,
        )

    def test_doctor_availability_with_different_timezones(self):
        """Test that doctor availability check works with different timezones"""
        from .assignments.appointment import AssignmentHandler

        # Patient (Paris) requests appointment for 2026-03-17 (Monday) at 14:00 Paris time
        # In Tokyo time, this is 2026-03-17 22:00 (outside doctor's hours 9-17)
        paris_tz = ZoneInfo("Europe/Paris")
        requested_datetime = datetime(2026, 3, 17, 14, 0, 0, tzinfo=paris_tz)

        # Create request
        request_obj = Request.objects.create(
            created_by=self.patient,
            expected_at=requested_datetime,
            expected_with=self.doctor,
            reason=self.reason,
        )

        # Create assignment handler
        handler = AssignmentHandler(request_obj)

        # Check if doctor is available (should be False - 22:00 Tokyo is outside 9-17 hours)
        is_available = handler._is_doctor_available(self.doctor)
        self.assertFalse(is_available)

    def test_doctor_availability_within_hours(self):
        """Test that doctor is available when time is within working hours"""
        from .assignments.appointment import AssignmentHandler

        # Patient (Paris) requests appointment for 2026-03-17 (Monday) at 02:00 Paris time
        # In Tokyo time, this is 2026-03-17 10:00 (within doctor's hours 9-17)
        paris_tz = ZoneInfo("Europe/Paris")
        requested_datetime = datetime(2026, 3, 17, 2, 0, 0, tzinfo=paris_tz)

        # Create request
        request_obj = Request.objects.create(
            created_by=self.patient,
            expected_at=requested_datetime,
            expected_with=self.doctor,
            reason=self.reason,
        )

        # Create assignment handler
        handler = AssignmentHandler(request_obj)

        # Check if doctor is available (should be True - 10:00 Tokyo is within 9-17 hours)
        is_available = handler._is_doctor_available(self.doctor)
        self.assertTrue(is_available)


class AssignmentManagerTest(TenantTestCase):
    """Test AssignmentManager exception handling"""

    def setUp(self):
        """Setup test data"""
        self.organisation = Organisation.objects.create(name="Test Org")

        # Create patient
        self.patient = User.objects.create_user(
            email="patient@example.com",
                        timezone="Europe/Paris",
            main_organisation=self.organisation,
        )

        # Create doctor
        self.doctor = User.objects.create_user(
            email="doctor@example.com",
                        timezone="UTC",
            main_organisation=self.organisation,
            is_practitioner=True,
        )

        # Create speciality and reason
        from users.models import Speciality
        self.speciality = Speciality.objects.create(name="General Medicine")
        self.reason = Reason.objects.create(
            name="Follow-up",
            speciality=self.speciality,
            is_active=True,
            duration=30,
            assignment_method="appointment",
        )

    def test_request_status_refused_on_exception(self):
        """Test that request status is set to refused when an exception occurs"""
        from .assignments import AssignmentManager
        from .models import RequestStatus

        # Create a request
        requested_datetime = datetime(2026, 3, 17, 14, 0, 0, tzinfo=ZoneInfo("Europe/Paris"))
        request_obj = Request.objects.create(
            created_by=self.patient,
            expected_at=requested_datetime,
            reason=self.reason,
            status=RequestStatus.requested,
        )

        # Use AssignmentManager and simulate an exception
        try:
            with AssignmentManager(request_obj) as assignment:
                # Force an exception
                raise Exception("Simulated error")
        except:
            pass

        # Refresh from database
        request_obj.refresh_from_db()

        # Check that status is refused (not cancelled)
        self.assertEqual(request_obj.status, RequestStatus.refused)
        self.assertIsNotNone(request_obj.refused_reason)
        self.assertIn("Simulated error", request_obj.refused_reason)


class ScheduledFilterUnreadTest(TenantTestCase):
    """A consultation with a future appointment normally sits in the "Planifié"
    tab (scheduled=true). As soon as it has unread messages it must move to the
    "À traiter" tab (scheduled=false) instead, so practitioners don't miss it.
    """

    def setUp(self):
        from rest_framework.test import APIClient
        from .models import Message

        self.Message = Message

        self.practitioner = User.objects.create_user(
            email="doc@example.com",
                        is_practitioner=True,
        )
        self.patient = User.objects.create_user(
            email="pat@example.com",
                    )

        # Consultation owned by the practitioner with a future scheduled appointment.
        self.consultation = Consultation.objects.create(
            beneficiary=self.patient,
            title="Follow-up",
            created_by=self.practitioner,
            owned_by=self.practitioner,
        )
        Appointment.objects.create(
            created_by=self.practitioner,
            consultation=self.consultation,
            scheduled_at=timezone.now() + timedelta(days=1),
            status=AppointmentStatus.scheduled,
        )

        self.client = APIClient()
        self.client.force_authenticate(user=self.practitioner)

    def _ids(self, scheduled):
        resp = self.client.get(
            "/api/consultations/",
            {"is_closed": "false", "scheduled": str(scheduled).lower()},
        )
        self.assertEqual(resp.status_code, 200, resp.content)
        data = resp.json()
        results = data["results"] if isinstance(data, dict) else data
        return {c["id"] for c in results}

    def test_no_unread_stays_scheduled(self):
        """No unread messages -> appears in Planifié, not in À traiter."""
        self.assertIn(self.consultation.id, self._ids(scheduled=True))
        self.assertNotIn(self.consultation.id, self._ids(scheduled=False))

    def test_unread_moves_to_overdue(self):
        """An unread message from someone else moves it to À traiter."""
        self.Message.objects.create(
            consultation=self.consultation,
            created_by=self.patient,
            content="Hello doctor",
        )
        self.assertIn(self.consultation.id, self._ids(scheduled=False))
        self.assertNotIn(self.consultation.id, self._ids(scheduled=True))

    def test_own_message_does_not_count_as_unread(self):
        """A message the practitioner sent themselves is not 'unread'."""
        self.Message.objects.create(
            consultation=self.consultation,
            created_by=self.practitioner,
            content="My own note",
        )
        self.assertIn(self.consultation.id, self._ids(scheduled=True))
        self.assertNotIn(self.consultation.id, self._ids(scheduled=False))

    def test_marking_read_returns_to_scheduled(self):
        """After the read status catches up, it goes back to Planifié."""
        from .models import ConsultationReadStatus

        self.Message.objects.create(
            consultation=self.consultation,
            created_by=self.patient,
            content="Hello doctor",
        )
        # Practitioner reads the consultation.
        ConsultationReadStatus.objects.update_or_create(
            consultation=self.consultation,
            user=self.practitioner,
            defaults={"last_read_at": timezone.now()},
        )
        self.assertIn(self.consultation.id, self._ids(scheduled=True))
        self.assertNotIn(self.consultation.id, self._ids(scheduled=False))


class ScheduledFilterReminderTest(TenantTestCase):
    """A consultation with no future appointment but an active reminder whose
    next occurrence is still in the future must count as "Planifié", not "À
    traiter" — recurrences included.
    """

    def setUp(self):
        from rest_framework.test import APIClient
        from .models import RecurrencePeriod, Reminder

        self.RecurrencePeriod = RecurrencePeriod
        self.Reminder = Reminder

        self.practitioner = User.objects.create_user(
            email="doc@example.com",
                        is_practitioner=True,
        )
        self.patient = User.objects.create_user(
            email="pat@example.com",
                    )
        # Consultation with NO appointment, so only reminders can make it
        # "upcoming".
        self.consultation = Consultation.objects.create(
            beneficiary=self.patient,
            title="Follow-up",
            created_by=self.practitioner,
            owned_by=self.practitioner,
        )

        self.client = APIClient()
        self.client.force_authenticate(user=self.practitioner)

    def _ids(self, scheduled):
        resp = self.client.get(
            "/api/consultations/",
            {"is_closed": "false", "scheduled": str(scheduled).lower()},
        )
        self.assertEqual(resp.status_code, 200, resp.content)
        data = resp.json()
        results = data["results"] if isinstance(data, dict) else data
        return {c["id"] for c in results}

    def _reminder(self, **overrides):
        data = dict(
            title="Take pills",
            recipient=self.patient,
            created_by=self.practitioner,
            consultation=self.consultation,
            scheduled_at=timezone.now() + timedelta(days=1),
        )
        data.update(overrides)
        return self.Reminder.objects.create(**data)

    def test_no_reminder_is_overdue(self):
        """No appointment and no reminder -> À traiter."""
        self.assertIn(self.consultation.id, self._ids(scheduled=False))
        self.assertNotIn(self.consultation.id, self._ids(scheduled=True))

    def test_future_reminder_is_scheduled(self):
        """A future one-off reminder -> Planifié, not À traiter."""
        self._reminder(scheduled_at=timezone.now() + timedelta(days=2))
        self.assertIn(self.consultation.id, self._ids(scheduled=True))
        self.assertNotIn(self.consultation.id, self._ids(scheduled=False))

    def test_past_reminder_is_overdue(self):
        """A reminder fully in the past -> back to À traiter."""
        self._reminder(scheduled_at=timezone.now() - timedelta(days=2))
        self.assertIn(self.consultation.id, self._ids(scheduled=False))
        self.assertNotIn(self.consultation.id, self._ids(scheduled=True))

    def test_inactive_reminder_is_overdue(self):
        """An inactive (cancelled) future reminder does not count."""
        self._reminder(
            scheduled_at=timezone.now() + timedelta(days=2),
            is_active=False,
        )
        self.assertIn(self.consultation.id, self._ids(scheduled=False))
        self.assertNotIn(self.consultation.id, self._ids(scheduled=True))

    def test_recurring_reminder_with_future_occurrence_is_scheduled(self):
        """A recurring reminder that started in the past but still has a future
        occurrence (via recurrence) -> Planifié.
        """
        # Started 2 days ago, weekly, 5 occurrences -> last occurrence is
        # ~4 weeks out, so a future occurrence definitely remains.
        self._reminder(
            scheduled_at=timezone.now() - timedelta(days=2),
            is_recurring=True,
            recurrence_period=self.RecurrencePeriod.week,
            recurrence_interval=1,
            recurrence_count=5,
        )
        self.assertIn(self.consultation.id, self._ids(scheduled=True))
        self.assertNotIn(self.consultation.id, self._ids(scheduled=False))

    def test_recurring_reminder_fully_past_is_overdue(self):
        """A recurring reminder whose every occurrence is in the past -> À
        traiter.
        """
        # Started 40 days ago, weekly, 3 occurrences -> last is ~26 days ago.
        self._reminder(
            scheduled_at=timezone.now() - timedelta(days=40),
            is_recurring=True,
            recurrence_period=self.RecurrencePeriod.week,
            recurrence_interval=1,
            recurrence_count=3,
        )
        self.assertIn(self.consultation.id, self._ids(scheduled=False))
        self.assertNotIn(self.consultation.id, self._ids(scheduled=True))

