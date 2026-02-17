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

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        if "event_type" in self.fields:
            choices = list(self.fields["event_type"].choices)
            if choices and choices[0][0] != "":
                choices.insert(0, ("", "---------"))
            self.fields["event_type"].choices = choices