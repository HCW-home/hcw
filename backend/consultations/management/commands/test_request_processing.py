from django.core.management.base import BaseCommand
from consultations.models import Request
from consultations.tasks import handle_request


class Command(BaseCommand):
    help = 'Test request processing by manually triggering the celery task'

    def add_arguments(self, parser):
        parser.add_argument(
            '--request-id',
            type=int,
            help='Request ID to process',
        )
        parser.add_argument(
            '--sync',
            action='store_true',
            help='Run task synchronously instead of through celery',
        )

    def handle(self, *args, **options):
        request_id = options.get('request_id')
        sync = options.get('sync', False)
        
        if not request_id:
            # Find the latest request
            try:
                request = Request.objects.latest('id')
                request_id = request.id
                self.stdout.write(f"Using latest request ID: {request_id}")
            except Request.DoesNotExist:
                self.stdout.write(self.style.ERROR('No requests found'))
                return
        
        try:
            if sync:
                self.stdout.write(f'Running task synchronously for request {request_id}...')
                result = handle_request(request_id)
            else:
                self.stdout.write(f'Queuing task for request {request_id}...')
                task_result = handle_request.delay(request_id)
                result = {
                    'task_queued': True,
                    'task_id': task_result.id,
                    'message': 'Check celery worker logs for execution results'
                }
            
            self.stdout.write(self.style.SUCCESS(f'Result: {result}'))
            
        except Exception as e:
            self.stdout.write(self.style.ERROR(f'Error: {str(e)}'))