from rest_framework.routers import DefaultRouter
from drf_spectacular.views import SpectacularAPIView, SpectacularRedocView, SpectacularSwaggerView
from . import views
from django.urls import path, include

router = DefaultRouter()

urlpatterns = [
    path('schema/', SpectacularAPIView.as_view(), name='schema'),
    path('docs/',
         SpectacularSwaggerView.as_view(url_name='schema'), name='swagger-ui'),
    path('auth/', include('dj_rest_auth.urls')),
    path('auth/token/', views.AnonymousTokenAuthView.as_view(), name='anonymous_token_auth'),
]