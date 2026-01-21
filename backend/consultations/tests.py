from datetime import timedelta
from unittest.mock import patch

from django.test import TestCase
from django.utils import timezone
from messaging.models import Message
from users.models import User

from .models import Appointment, AppointmentStatus, Consultation, Participant
from .tasks import handle_invites

# Create your tests here.


class AppointmentTest(TestCase):
    def setUp(self):
        """Préparation des données pour chaque test"""
        self.patient = User.objects.create_user(
            email="patient@example.com", password="testpass123"
        )
        self.practitioner = User.objects.create_user(
            email="practitioner@example.com", password="testpass123"
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
        self.assertTrue(self.participant1.is_notified)
        self.assertFalse(self.participant2.is_notified)

        self.appointment.status = AppointmentStatus.scheduled
        self.appointment.save()

        handle_invites(self.appointment.pk)

        self.assertEqual(Message.objects.count(), 2)

        for message in Message.objects.all():
            self.assertTrue(message.template_is_valid)
