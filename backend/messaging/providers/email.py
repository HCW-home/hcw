from . import BaseProvider
from django.utils.translation import gettext_lazy as _

class Main(BaseProvider):

    display_name = _("Email over Django SMTP")
    communication_method = "EMAIL"
