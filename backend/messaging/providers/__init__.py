from typing import Optional
from ..models import MessagingProvider, ProviderName
from .base import BaseProvider
import logging

logger = logging.getLogger(__name__)


class ProviderFactory:
    """
    Factory class to create messaging provider instances
    """
    
    _providers = {}
    
    @classmethod
    def register_provider(cls, provider_name: str, provider_class: type):
        """
        Register a provider class for a given provider name
        
        Args:
            provider_name (str): The provider name (from ProviderName choices)
            provider_class (type): The provider class that extends BaseProvider
        """
        if not issubclass(provider_class, BaseProvider):
            raise ValueError(f"Provider class {provider_class} must extend BaseProvider")
        
        cls._providers[provider_name] = provider_class
        logger.debug(f"Registered provider {provider_name}: {provider_class}")
    
    @classmethod
    def create_provider(cls, provider: MessagingProvider) -> Optional[BaseProvider]:
        """
        Create a provider instance for the given provider configuration
        
        Args:
            provider (MessagingProvider): The provider configuration from database
            
        Returns:
            Optional[BaseProvider]: Provider instance or None if not found
        """
        if not provider:
            logger.error("Provider configuration is None")
            return None
            
        if not provider.is_active:
            logger.warning(f"Provider {provider.name} is not active")
            return None
        
        provider_class = cls._providers.get(provider.name)
        if not provider_class:
            logger.error(f"No provider class registered for {provider.name}")
            return None
        
        try:
            instance = provider_class(provider)
            logger.debug(f"Created provider instance: {provider.name}")
            return instance
        except Exception as e:
            logger.error(f"Failed to create provider {provider.name}: {e}")
            return None
    
    @classmethod
    def get_registered_providers(cls) -> dict:
        """
        Get all registered provider classes
        
        Returns:
            dict: Dictionary of provider_name -> provider_class
        """
        return cls._providers.copy()
    
    @classmethod
    def is_provider_supported(cls, provider_name: str) -> bool:
        """
        Check if a provider is supported (registered)
        
        Args:
            provider_name (str): The provider name to check
            
        Returns:
            bool: True if provider is supported
        """
        return provider_name in cls._providers


# Auto-import and register all providers
def _register_providers():
    """
    Auto-register providers using naming convention
    """
    import importlib
    from ..models import ProviderName
    
    for provider_name in ProviderName:
        # SWISSCOM -> swisscom, SwisscomProvider  
        module_name = provider_name.name.lower().split('_')[0]  # twilio_whatsapp -> twilio
        class_name = f"{provider_name.name.split('_')[0].title()}Provider"
        
        try:
            module = importlib.import_module(f".{module_name}", __package__)
            provider_class = getattr(module, class_name)
            ProviderFactory.register_provider(provider_name, provider_class)
            logger.debug(f"Registered {provider_name}: {class_name}")
        except (ImportError, AttributeError):
            logger.debug(f"Provider {class_name} not available")


# Register providers on module import
_register_providers()


# Export commonly used classes and functions
__all__ = [
    'ProviderFactory',
    'BaseProvider'
]