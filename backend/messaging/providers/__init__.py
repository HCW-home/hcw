from importlib import import_module
from pkgutil import iter_modules
from typing import TYPE_CHECKING, List, Dict, Tuple, Any
from abc import ABC, abstractmethod

if TYPE_CHECKING:
    from ..models import CommunicationMethod, Message, MessageStatus, MessagingProvider

__all__: List[str] = []


class BaseProvider(ABC):
    """
    Abstract base class for messaging providers.
    All messaging providers must implement this interface.
    """

    display_name: str = ''
    communication_method: 'CommunicationMethod'

    def __init__(self, messaging_provider: 'MessagingProvider'):
        self.messaging_provider = messaging_provider

    @abstractmethod
    def send(self, message: 'Message') -> 'MessageStatus':
        """
        Send message via this provider
        
        The provider will determine how to send the message based on the
        message's communication_method field (SMS, WhatsApp, Email, etc.)
        
        Args:
            message (Message): The message to send
            
        Returns:
            MessageStatus: Status of the message send operation
        """

    @abstractmethod
    def test_connection(self) -> Tuple[bool, Any]:
        """
        Test connection to the provider's API
        Default implementation just validates configuration
        
        Returns:
            - True, True if connection test passed
            - error (str, optional): Error message if failed
        """


MAIN_CLASSES: Dict[str, BaseProvider] = {}
MAIN_DISPLAY_NAMES: List[Tuple[str, str]] = []

# __path__ is defined for packages; iter_modules lists names in this package dir
for _, module_name, _ in iter_modules(__path__):
    if module_name.startswith("_"):  # skip private modules
        continue
    module = import_module(f".{module_name}", __name__)
    globals()[module_name] = module   # expose as package attribute
    __all__.append(module_name)
    
    # Look for Main class that inherits from BaseProvider
    if hasattr(module, 'Main') and issubclass(module.Main, BaseProvider):
        provider_class = module.Main
        MAIN_CLASSES[module_name] = provider_class
        MAIN_DISPLAY_NAMES.append((module_name, provider_class.display_name))
