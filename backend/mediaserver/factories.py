import factory
from factory.django import DjangoModelFactory

# Since mediaserver/models.py is currently empty (only contains imports and comments),
# this factories file is ready for future model factories.
# When models are added to the mediaserver app, add corresponding factories here following the pattern:

# Example structure for future use:
# class YourMediaServerModelFactory(DjangoModelFactory):
#     class Meta:
#         model = YourMediaServerModel
#
#     field_name = factory.Faker('appropriate_provider')
#     # ... other fields