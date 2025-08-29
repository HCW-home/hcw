from rest_framework import viewsets
from rest_framework.permissions import IsAuthenticated


class CreatedByMixin:
    """
    Mixin for ModelViewSets that automatically sets created_by field 
    to the authenticated user on create operations.
    
    Usage:
        class MyViewSet(CreatedByMixin, viewsets.ModelViewSet):
            ...
    
    Requirements:
        - Model must have a 'created_by' field (ForeignKey to User)
        - View must have authentication enabled
    """
    
    def perform_create(self, serializer):
        """Override perform_create to set created_by field"""
        if hasattr(self.get_serializer().Meta.model, 'created_by'):
            serializer.save(created_by=self.request.user)
        else:
            serializer.save()


# class OwnedByUserMixin:
#     """
#     Mixin that filters queryset to show only objects created by the current user
#     and sets created_by on creation.
    
#     Usage:
#         class MyViewSet(OwnedByUserMixin, viewsets.ModelViewSet):
#             ...
#     """
    
#     def get_queryset(self):
#         """Filter queryset to user's own objects"""
#         queryset = super().get_queryset()
#         if hasattr(queryset.model, 'created_by'):
#             return queryset.filter(created_by=self.request.user)
#         return queryset
    
#     def perform_create(self, serializer):
#         """Set created_by field on creation"""
#         if hasattr(self.get_serializer().Meta.model, 'created_by'):
#             serializer.save(created_by=self.request.user)
#         else:
#             serializer.save()


class CreatedByReadOnlyMixin:
    """
    Mixin that makes created_by field read-only in serializer
    and automatically sets it on creation.
    
    Usage:
        class MyViewSet(CreatedByReadOnlyMixin, viewsets.ModelViewSet):
            ...
    """
    
    def get_serializer(self, *args, **kwargs):
        """Make created_by field read-only"""
        serializer = super().get_serializer(*args, **kwargs)
        if hasattr(serializer.fields, 'created_by'):
            serializer.fields['created_by'].read_only = True
        return serializer
    
    def perform_create(self, serializer):
        """Set created_by field on creation"""
        if hasattr(self.get_serializer().Meta.model, 'created_by'):
            serializer.save(created_by=self.request.user)
        else:
            serializer.save()