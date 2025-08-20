
from django.core.validators import RegexValidator

hex_validator = RegexValidator(
    regex=r'^[0-9a-fA-F]+$',
    message='Enter a valid hexadecimal value.'
)
