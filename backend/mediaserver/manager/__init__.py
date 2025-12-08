from abc import ABC, abstractmethod
from importlib import import_module
from pkgutil import iter_modules
from typing import TYPE_CHECKING, Any, Dict, List, Tuple, Type

from consultations.models import Consultation, Participant, User

if TYPE_CHECKING:
    from ..models import Server

__all__: List[str] = []


class BaseMediaserver(ABC):
    display_name: str = ""

    def __init__(self, server: "Server"):
        self.server = server

    @abstractmethod
    def test_connection(self) -> Tuple[bool, Any]:
        """
        Test connection to the provider's API
        Default implementation just validates configuration

        Returns:
            - True, True if connection test passed
            - error (str): Error message if failed
        """

    @abstractmethod
    def appointment_participant_info(self, participant: Participant):
        """
        Return room and token info for Participant
        """

    @abstractmethod
    def consultation_user_info(self, consultation: Consultation, user: User):
        """
        Return room and token info for User for specific consultation
        """
        
    @abstractmethod
    def user_test_info(self, user: User):
        """
        Return room and token info for User self test
        """



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
