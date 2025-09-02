from django.test import TestCase
from django.contrib.auth.models import Permission
from django.contrib.contenttypes.models import ContentType
from rest_framework.test import APITestCase, APIClient
from rest_framework_simplejwt.tokens import RefreshToken
from unittest.mock import patch
from datetime import datetime, timedelta
from django.utils import timezone


class BaseTestCase(TestCase):
    """Base test case with common utilities"""
    
    def setUp(self):
        super().setUp()


class APITestMixin:
    """Mixin for API test cases with authentication helpers"""
    
    def authenticate_user(self, user):
        """Authenticate a user for API requests"""
        refresh = RefreshToken.for_user(user)
        self.client.credentials(HTTP_AUTHORIZATION=f'Bearer {refresh.access_token}')
    
    def unauthenticate(self):
        """Remove authentication"""
        self.client.credentials()


class BaseAPITestCase(APITestCase, APITestMixin):
    """Base API test case with authentication helpers"""
    pass


class CeleryTestMixin:
    """Mixin for testing celery tasks"""
    
    def setUp(self):
        super().setUp()
        # Mock celery tasks to run synchronously
        self.celery_patch = patch('celery.current_app.send_task')
        self.mock_send_task = self.celery_patch.start()
    
    def tearDown(self):
        self.celery_patch.stop()
        super().tearDown()


class TimeTestMixin:
    """Mixin for time-related test utilities"""
    
    @staticmethod
    def next_monday():
        """Get next Monday's date"""
        today = timezone.now().date()
        days_ahead = 0 - today.weekday()  # Monday is 0
        if days_ahead <= 0:  # Target day already happened this week
            days_ahead += 7
        return today + timedelta(days_ahead)
    
    @staticmethod
    def next_weekday(weekday):
        """
        Get next occurrence of a specific weekday
        Args:
            weekday: 0=Monday, 1=Tuesday, ..., 6=Sunday
        """
        today = timezone.now().date()
        days_ahead = weekday - today.weekday()
        if days_ahead <= 0:  # Target day already happened this week
            days_ahead += 7
        return today + timedelta(days_ahead)
    
    @staticmethod
    def create_datetime_on_day(weekday, hour=10, minute=0):
        """
        Create a datetime on the next occurrence of a specific weekday
        Args:
            weekday: 0=Monday, 1=Tuesday, ..., 6=Sunday
            hour: Hour (24-hour format)
            minute: Minute
        """
        date = TimeTestMixin.next_weekday(weekday)
        return timezone.make_aware(datetime.combine(date, datetime.min.time().replace(hour=hour, minute=minute)))


class PermissionTestMixin:
    """Mixin for testing permissions"""
    
    def create_user_with_permissions(self, user, permissions):
        """
        Add specific permissions to a user
        
        Args:
            user: User instance
            permissions: List of permission codenames like ['view_consultation', 'add_consultation']
        """
        from django.contrib.auth.models import Permission
        from django.contrib.contenttypes.models import ContentType
        
        for perm_code in permissions:
            app_label, codename = perm_code.split('.') if '.' in perm_code else ('consultations', perm_code)
            try:
                permission = Permission.objects.get(codename=codename, content_type__app_label=app_label)
                user.user_permissions.add(permission)
            except Permission.DoesNotExist:
                # Create permission if it doesn't exist
                content_type = ContentType.objects.get(app_label=app_label)
                permission = Permission.objects.create(
                    codename=codename,
                    name=f'Can {codename}',
                    content_type=content_type
                )
                user.user_permissions.add(permission)
    
    def assert_requires_permission(self, url, method='get', permission=None):
        """
        Assert that an endpoint requires authentication and specific permission
        
        Args:
            url: URL to test
            method: HTTP method ('get', 'post', 'put', 'delete')
            permission: Permission codename to test
        """
        # Test unauthenticated access
        self.unauthenticate()
        response = getattr(self.client, method)(url)
        self.assertEqual(response.status_code, 401, "Endpoint should require authentication")
        
        # Test authenticated but without permission
        if permission:
            from .factories import UserFactory
            user = UserFactory()
            self.authenticate_user(user)
            response = getattr(self.client, method)(url)
            self.assertEqual(response.status_code, 403, f"Endpoint should require {permission} permission")
    
    def assert_permission_allows_access(self, url, method='get', permission=None, expected_status=200):
        """
        Assert that a user with specific permission can access endpoint
        
        Args:
            url: URL to test
            method: HTTP method
            permission: Permission codename
            expected_status: Expected HTTP status code
        """
        from .factories import UserFactory
        user = UserFactory()
        if permission:
            self.create_user_with_permissions(user, [permission])
        
        self.authenticate_user(user)
        response = getattr(self.client, method)(url)
        self.assertEqual(response.status_code, expected_status, 
                        f"User with {permission} permission should access endpoint")


class MockTaskMixin:
    """Mixin for mocking celery tasks in tests"""
    
    def mock_task_result(self, task_name, return_value=None, side_effect=None):
        """
        Mock a celery task
        
        Args:
            task_name: Full task name (e.g., 'consultations.tasks.handle_request')
            return_value: Value to return
            side_effect: Side effect to apply
        """
        patcher = patch(task_name)
        mock_task = patcher.start()
        
        if return_value is not None:
            mock_task.return_value = return_value
        if side_effect is not None:
            mock_task.side_effect = side_effect
            
        self.addCleanup(patcher.stop)
        return mock_task


class AssertionHelpers:
    """Additional assertion helpers for consultations"""
    
    def assertConsultationCreated(self, request, consultation):
        """Assert consultation was created correctly from request"""
        self.assertEqual(consultation.created_by, request.created_by)
        self.assertEqual(consultation.beneficiary, request.beneficiary or request.created_by)
    
    def assertAppointmentCreated(self, request, appointment, doctor=None):
        """Assert appointment was created correctly from request"""
        self.assertEqual(appointment.scheduled_at, request.expected_at)
        self.assertEqual(appointment.type, request.type)
        if doctor:
            self.assertEqual(appointment.consultation.owned_by, doctor)
    
    def assertParticipantsCreated(self, appointment, expected_participants):
        """Assert correct participants were created for appointment"""
        participants = appointment.participant_set.all()
        participant_users = [p.user for p in participants if p.user]
        for expected_user in expected_participants:
            self.assertIn(expected_user, participant_users)