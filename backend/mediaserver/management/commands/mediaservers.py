import asyncio
from django.core.management.base import BaseCommand
from ...models import Server
from consultations.models import RequestStatus
from ... import manager


class Command(BaseCommand):
    help = 'Run a specific cleaning tasks'

    def add_arguments(self, parser):
        parser.add_argument("action")
        parser.add_argument("parameters", nargs="*")

    def handle(self, *args, **options):
        parameters = options.get('parameters')
        action = options.get('action')
        
        # if action == "check":
        #     for server in Server.objects.all():
        #         asyncio.run(self.check_server(server))

        if action == 'test':
            for server in Server.objects.all():
                server.instance.test_connection()
