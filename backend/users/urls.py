
from django.urls import path, include
from rest_framework.routers import DefaultRouter
from . import views

router = DefaultRouter()
router.register(r'specialities', views.SpecialityViewSet)

urlpatterns = [
    path('home/', views.Home.as_view()),
    path('api/', include(router.urls)),
]

