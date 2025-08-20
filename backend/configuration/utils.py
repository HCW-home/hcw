from django.core.cache import cache
from .models import Configuration

def get_config(key, default=None, cache_timeout=300):
    """
    Get configuration value with caching support.
    
    :param key: Configuration key
    :param default: Default value if key doesn't exist
    :param cache_timeout: Cache timeout in seconds (default: 5 minutes)
    :return: Configuration value or default
    """
    cache_key = f"config_{key}"
    value = cache.get(cache_key)
    
    if value is None:
        value = Configuration.get_value(key, default)
        cache.set(cache_key, value, cache_timeout)
    
    return value

def set_config(key, value, description=""):
    """
    Set configuration value and invalidate cache.
    
    :param key: Configuration key
    :param value: Configuration value  
    :param description: Optional description
    :return: Configuration instance
    """
    config = Configuration.set_value(key, value, description)
    
    # Invalidate cache
    cache_key = f"config_{key}"
    cache.delete(cache_key)
    
    return config

def invalidate_config_cache(key):
    """
    Invalidate cache for a specific configuration key.
    
    :param key: Configuration key
    """
    cache_key = f"config_{key}"
    cache.delete(cache_key)