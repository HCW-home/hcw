from django import forms
from django.contrib import admin
from django.contrib.postgres.fields import ArrayField
from django.db import models
from .models import CommunicationMethod, Template

class TemplateForm(forms.ModelForm):
    communication_method = forms.MultipleChoiceField(
        choices=CommunicationMethod.choices,
        widget=forms.CheckboxSelectMultiple,
        required=False,
    )

    class Meta:
        model = Template
        fields = "__all__"