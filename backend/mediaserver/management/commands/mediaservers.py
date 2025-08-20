import asyncio
from django.core.management.base import BaseCommand
from ...manager.janus import Janus
from ...models import Server

class Command(BaseCommand):
    help = 'Run a specific cleaning tasks'

    def add_arguments(self, parser):
        parser.add_argument("action")
        parser.add_argument("parameters", nargs="*")

    def handle(self, *args, **options):
        parameters = options.get('parameters')
        action = options.get('action')
        
        if action == "check":
            for server in Server.objects.all():
                asyncio.run(self.check_server(server))

    async def check_server(self, server):
        janus = Janus(server)
        await janus.attach()
        await janus.create_room()
        print(janus.session.plugin_handles)
        await janus.destroy_room()
