from django.urls import re_path

from . import consumers

websocket_urlpatterns = [
    re_path(r"ws/consultation/(?P<consultation_pk>\w+)/$", consumers.ConsultationConsumer.as_asgi()),
]
