from . import BaseMediaserver
from livekit import api
import asyncio

class Main(BaseMediaserver):
    name = 'livekit'
    display_name = "LiveKit"

    def __init__(self, server):
        super().__init__(server)
        self._client = None

    @property
    def client(self):
        """Lazy initialization of client within async context"""
        if self._client is None:
            self._client = api.LiveKitAPI(
                self.server.url,
                self.server.api_token,
                self.server.api_secret
            )
        return self._client

    async def _test_connection_async(self):
        """Async implementation of test_connection"""
        async with api.LiveKitAPI(
            url=self.server.url,
            api_key=self.server.api_token,
            api_secret=self.server.api_secret,
        ) as client:
            req = api.ListRoomsRequest()
            return await client.room.list_rooms(req)

    def test_connection(self):
        """Synchronous wrapper for test_connection"""
        return asyncio.run(self._test_connection_async())