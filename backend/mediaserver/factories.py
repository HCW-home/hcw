import factory
from factory.django import DjangoModelFactory

from .models import Server


class ServerFactory(DjangoModelFactory):
    class Meta:
        model = Server

    url = factory.Sequence(lambda n: f"https://media-{n}.example.com")
    api_token = factory.Faker("uuid4")
    api_secret = factory.Faker("uuid4")
    max_session_number = 10
    type = "livekit"
    is_active = True
