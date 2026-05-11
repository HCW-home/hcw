from abc import ABC, abstractmethod
from importlib import import_module
from pkgutil import iter_modules
from typing import TYPE_CHECKING, Any, Dict, List, Tuple, Type

from consultations.models import Appointment, Consultation, User

if TYPE_CHECKING:
    from ..models import Server

__all__: List[str] = []


class BaseMediaserver(ABC):
    name: str = ""
    display_name: str = ""

    def __init__(self, server: "Server"):
        self.server: "Server" = server

    @abstractmethod
    def test_connection(self) -> Tuple[bool, Any]:
        """
        Test connection to the provider's API.

        Returns:
            - (True, payload) if reachable
            - raises Exception otherwise (callers catch broadly)
        """

    @abstractmethod
    def appointment_participant_info(self, appointment: Appointment, user: User) -> dict:
        """Return join info for an appointment participant.

        Returns a dict with at least: provider, url, token, room.
        """

    @abstractmethod
    def consultation_user_info(self, consultation: Consultation, user: User) -> dict:
        """Return join info for a consultation participant.

        Returns a dict with at least: provider, url, token, room.
        """

    @abstractmethod
    def user_test_info(self, user: User, room_uuid=None) -> dict:
        """Return join info for a user-driven self test.

        Returns a dict with at least: provider, url, token, room.
        """

    def supports_recording(self) -> bool:
        """Whether this provider supports server-side recording (egress)."""
        return True


MAIN_CLASSES: Dict[str, Type[BaseMediaserver]] = {}
MAIN_DISPLAY_NAMES: List[Tuple[str, str]] = []

# __path__ is defined for packages; iter_modules lists names in this package dir
for _, module_name, _ in iter_modules(__path__):
    if module_name.startswith("_"):  # skip private modules
        continue
    module = import_module(f".{module_name}", __name__)
    globals()[module_name] = module  # expose as package attribute
    __all__.append(module_name)

    # Look for Main class that inherits from BaseProvider
    if hasattr(module, "Main") and issubclass(module.Main, BaseMediaserver):
        provider_class = module.Main
        MAIN_CLASSES[module_name] = provider_class
        MAIN_DISPLAY_NAMES.append((module_name, provider_class.display_name))
