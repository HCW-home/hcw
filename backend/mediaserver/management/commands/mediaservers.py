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

        if action == "listen":
            server_id = parameters[0]
            server = Server.objects.get(pk=server_id)
            asyncio.run(self.listen_event(server))

    async def check_server(self, server):
        janus = Janus(server)
        await janus.attach()
        await janus.create_room()
        await janus.add_participant("Test")
        for p in await janus.participants:
            print(p)
        await janus.destroy_room()

    async def listen_event(self, server):
        janus = Janus(server)
        await janus.attach()
        janus._room_id = 1234
        await janus.create_room()
        await janus.add_participant("Test")
        print("Waiting for events... press Ctrl+C to stop")
        try:
            while True:
                # for p in await janus.participants:
                #     print(p)
                await asyncio.sleep(1)
        except KeyboardInterrupt:
            pass
        finally:
            await janus.destroy_room()
