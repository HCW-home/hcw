from django.db import models
from django.utils.translation import gettext_lazy as _
from django.core.cache import cache
from django.conf import settings

class Configuration(models.Model):
    key = models.CharField(max_length=255, unique=True, help_text=_("Configuration key"))
    value = models.TextField(help_text=_("Configuration value"))
    description = models.TextField(blank=True, help_text=_("Description of this configuration option"))
    is_default = models.BooleanField(default=False, help_text=_("Is this a default system configuration"))
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name = _("Configuration")
        verbose_name_plural = _("Configurations")
        ordering = ['key']

    def __str__(self):
        return f"{self.key}: {self.value[:50]}..."

    @classmethod
    def get_value(cls, key, default=None):
        """
        Get configuration value by key.
        
        :param key: Configuration key
        :param default: Default value if key doesn't exist
        :return: Configuration value or default
        """
        try:
            config = cls.objects.get(key=key)
            return config.value
        except cls.DoesNotExist:
            return default

    @classmethod
    def set_value(cls, key, value, description=""):
        """
        Set configuration value by key.
        
        :param key: Configuration key
        :param value: Configuration value
        :param description: Optional description
        :return: Configuration instance
        """
        config, _ = cls.objects.update_or_create(
            key=key,
            defaults={'value': value, 'description': description}
        )
        return config

    def save(self, *args, **kwargs):
        super().save(*args, **kwargs)
        # Invalidate cache when configuration is saved
        cache_key = f"config_{self.key}"
        cache.delete(cache_key)

    def delete(self, *args, **kwargs):
        # Prevent deletion of configurations
        raise models.ProtectedError(
            _("Configuration entries cannot be deleted. Use reset to restore default values."),
            [self]
        )

    @classmethod
    def reset_to_default(cls, key):
        """
        Reset a configuration key to its default value.
        
        :param key: Configuration key to reset
        :return: Configuration instance or None if no default exists
        """
        defaults = getattr(settings, 'DEFAULT_CONFIGURATIONS', {})
        if key in defaults:
            default_config = defaults[key]
            config, created = cls.objects.update_or_create(
                key=key,
                defaults={
                    'value': default_config['value'],
                    'description': default_config['description'],
                    'is_default': True
                }
            )
            # Invalidate cache
            cache_key = f"config_{key}"
            cache.delete(cache_key)
            return config
        return None

    @classmethod
    def initialize_defaults(cls):
        """
        Initialize all default configurations from settings.
        """
        defaults = getattr(settings, 'DEFAULT_CONFIGURATIONS', {})
        created_count = 0
        
        for key, config_data in defaults.items():
            config, created = cls.objects.get_or_create(
                key=key,
                defaults={
                    'value': config_data['value'],
                    'description': config_data['description'],
                    'is_default': True
                }
            )
            if created:
                created_count += 1
        
        return created_count

    def get_default_value(self):
        """
        Get the default value for this configuration key.
        
        :return: Default value or None if no default exists
        """
        defaults = getattr(settings, 'DEFAULT_CONFIGURATIONS', {})
        if self.key in defaults:
            return defaults[self.key]['value']
        return None

    def is_modified_from_default(self):
        """
        Check if current value differs from default value.
        
        :return: True if value is modified from default
        """
        default_value = self.get_default_value()
        return default_value is not None and self.value != default_value
