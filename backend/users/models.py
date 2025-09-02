import json
from typing import List, Optional
from django.db import models
from django.contrib.auth.models import AbstractUser
from django.forms import ValidationError
from django.utils.translation import gettext_lazy as _
from firebase_admin.messaging import Message
from firebase_admin.messaging import Notification as FireBaseNotification
from fcm_django.models import FirebaseResponseDict
from fcm_django.models import AbstractFCMDevice
from .abstracts import ModelOwnerAbstract
from .cryptomanager import CryptoManager
from django.utils import timezone
from . import validators
from channels.layers import get_channel_layer
from asgiref.sync import async_to_sync
from django.utils.translation import gettext_lazy as _
from messaging.models import CommunicationMethod
from django.conf import settings
from django.core.validators import MinValueValidator, MaxValueValidator
import pytz

from django.db import models

# Create your models here.

class Term(models.Model):
    name = models.CharField()
    content = models.TextField()
    valid_until = models.DateTimeField()

    def __str__(self):
        return self.name

class Organisation(models.Model):
    name = models.CharField(max_length=200)
    logo_large = models.ImageField(
        upload_to='organisations/', blank=True, null=True)
    logo_small = models.ImageField(
        upload_to='organisations/', blank=True, null=True)
    primary_color = models.CharField(max_length=7, blank=True, null=True)
    default_term = models.ForeignKey(Term, on_delete=models.SET_NULL, null=True, blank=True)
    location_latitude = models.DecimalField(max_digits=9, decimal_places=6, help_text="Latitude in decimal degrees", null=True, blank=True)
    location_longitude = models.DecimalField(max_digits=9, decimal_places=6, help_text="Longitude in decimal degrees", null=True, blank=True)
    street = models.CharField(max_length=200, blank=True, null=True)
    city = models.CharField(max_length=50, blank=True, null=True)
    postal_code = models.CharField(max_length=10, blank=True, null=True)
    country = models.CharField(max_length=50, blank=True, null=True)

    def __str__(self):
        return self.name

class Language(models.Model):
    name = models.CharField(max_length=100)
    code = models.CharField(max_length=3, unique=True)

    def __str__(self):
        return self.name

class Speciality(models.Model):
    name = models.CharField(_("name"), max_length=100)

    class Meta:
        verbose_name = _("speciality")
        verbose_name_plural = _("specialities")

    def __str__(self):
        return self.name

class FCMDeviceOverride(AbstractFCMDevice):
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

class User(AbstractUser):
    app_preferences = models.JSONField(null=True, blank=True)
    encrypted = models.BooleanField(default=False)

    languages = models.ManyToManyField(Language, blank=True)

    preferred_language = models.CharField(
        max_length=10,
        choices=settings.LANGUAGES,
        help_text="Preferred language for the user interface",
        null=True, blank=True
    )
    
    specialities = models.ManyToManyField(Speciality, blank=True)
    organisations = models.ManyToManyField('users.Organisation', blank=True)
    accepted_term = models.ForeignKey(Term, on_delete=models.SET_NULL, null=True, blank=True)
    main_organisation = models.ForeignKey(
        'users.Organisation', blank=True, null=True, on_delete=models.SET_NULL, related_name="users_mainorganisation")
    communication_method = models.CharField(
        choices=CommunicationMethod.choices, default=CommunicationMethod.EMAIL)
    mobile_phone_numer = models.CharField(null=True, blank=True)
    timezone = models.CharField(
        max_length=63,
        choices=[(tz, tz) for tz in pytz.all_timezones],
        default='UTC',
        help_text='User timezone for displaying dates and times'
    )

    def send_user_notification(self, title, message) -> FirebaseResponseDict:
        # Docs https://fcm-django.readthedocs.io/en/latest/
        """
        Send notification to user over Firebase Cloud Messaging (FCM).

        :param title: notification
        :param message: Notification body
        """

        message = Message(
            notification=FireBaseNotification(title=title, body=message),
        )

        devices = FCMDeviceOverride.objects.filter(user=self)
        return devices.send_message(
            message
        )

class HealthMetric(models.Model):
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="recorded_health_metrics_creator",
    )

    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
    )

    measured_at = models.DateTimeField(
        help_text="When the measurements were taken"
    )

    measured_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True, blank=True,
        related_name="recorded_health_metrics",
        help_text="Clinician or device user who recorded the measurements (optional)"
    )


    # Anthropometrics
    height_cm = models.DecimalField(
        max_digits=5, decimal_places=2, null=True, blank=True,
        validators=[MinValueValidator(30), MaxValueValidator(280)],
        help_text="Height in centimeters"
    )
    weight_kg = models.DecimalField(
        max_digits=6, decimal_places=2, null=True, blank=True,
        validators=[MinValueValidator(1), MaxValueValidator(500)],
        help_text="Weight in kilograms"
    )
    waist_cm = models.DecimalField(
        max_digits=5, decimal_places=1, null=True, blank=True,
        validators=[MinValueValidator(20), MaxValueValidator(250)],
        help_text="Waist circumference in centimeters"
    )
    hip_cm = models.DecimalField(
        max_digits=5, decimal_places=1, null=True, blank=True,
        validators=[MinValueValidator(20), MaxValueValidator(250)],
        help_text="Hip circumference in centimeters"
    )
    body_fat_pct = models.DecimalField(
        max_digits=5, decimal_places=2, null=True, blank=True,
        validators=[MinValueValidator(1), MaxValueValidator(80)],
        help_text="Body fat percentage"
    )

    # Vital signs
    systolic_bp = models.PositiveSmallIntegerField(
        null=True, blank=True,
        validators=[MinValueValidator(50), MaxValueValidator(300)],
        help_text="Systolic blood pressure in mmHg"
    )
    diastolic_bp = models.PositiveSmallIntegerField(
        null=True, blank=True,
        validators=[MinValueValidator(30), MaxValueValidator(200)],
        help_text="Diastolic blood pressure in mmHg"
    )
    heart_rate_bpm = models.PositiveSmallIntegerField(
        null=True, blank=True,
        validators=[MinValueValidator(20), MaxValueValidator(250)],
        help_text="Heart rate in beats per minute"
    )
    respiratory_rate = models.PositiveSmallIntegerField(
        null=True, blank=True,
        validators=[MinValueValidator(4), MaxValueValidator(80)],
        help_text="Respiratory rate in breaths per minute"
    )
    temperature_c = models.DecimalField(
        max_digits=4, decimal_places=2, null=True, blank=True,
        validators=[MinValueValidator(30), MaxValueValidator(45)],
        help_text="Body temperature in °C"
    )
    spo2_pct = models.PositiveSmallIntegerField(
        null=True, blank=True,
        validators=[MinValueValidator(50), MaxValueValidator(100)],
        help_text="Oxygen saturation (SpO2) in %"
    )
    pain_score_0_10 = models.PositiveSmallIntegerField(
        null=True, blank=True,
        validators=[MinValueValidator(0), MaxValueValidator(10)],
        help_text="Pain score (0 = none, 10 = worst possible)"
    )

    # Glucose / diabetes
    glucose_fasting_mgdl = models.DecimalField(
        max_digits=6, decimal_places=2, null=True, blank=True,
        validators=[MinValueValidator(20), MaxValueValidator(1000)],
        help_text="Fasting blood glucose in mg/dL"
    )
    glucose_random_mgdl = models.DecimalField(
        max_digits=6, decimal_places=2, null=True, blank=True,
        validators=[MinValueValidator(20), MaxValueValidator(1000)],
        help_text="Random blood glucose in mg/dL"
    )
    hba1c_pct = models.DecimalField(
        max_digits=4, decimal_places=2, null=True, blank=True,
        validators=[MinValueValidator(3), MaxValueValidator(20)],
        help_text="Hemoglobin A1c percentage"
    )

    # Lipid panel
    chol_total_mgdl = models.DecimalField(
        max_digits=6, decimal_places=2, null=True, blank=True,
        validators=[MinValueValidator(50), MaxValueValidator(500)],
        help_text="Total cholesterol in mg/dL"
    )
    hdl_mgdl = models.DecimalField(
        max_digits=6, decimal_places=2, null=True, blank=True,
        validators=[MinValueValidator(5), MaxValueValidator(150)],
        help_text="HDL cholesterol in mg/dL"
    )
    ldl_mgdl = models.DecimalField(
        max_digits=6, decimal_places=2, null=True, blank=True,
        validators=[MinValueValidator(10), MaxValueValidator(300)],
        help_text="LDL cholesterol in mg/dL"
    )
    triglycerides_mgdl = models.DecimalField(
        max_digits=6, decimal_places=2, null=True, blank=True,
        validators=[MinValueValidator(20), MaxValueValidator(1000)],
        help_text="Triglycerides in mg/dL"
    )

    # Renal function
    creatinine_mgdl = models.DecimalField(
        max_digits=5, decimal_places=3, null=True, blank=True,
        validators=[MinValueValidator(0.1), MaxValueValidator(20)],
        help_text="Serum creatinine in mg/dL"
    )
    egfr_ml_min_1_73m2 = models.DecimalField(
        max_digits=6, decimal_places=1, null=True, blank=True,
        validators=[MinValueValidator(1), MaxValueValidator(200)],
        help_text="Estimated GFR in mL/min/1.73m²"
    )
    bun_mgdl = models.DecimalField(
        max_digits=5, decimal_places=1, null=True, blank=True,
        validators=[MinValueValidator(1), MaxValueValidator(200)],
        help_text="Blood urea nitrogen (BUN) in mg/dL"
    )

    # Liver panel
    alt_u_l = models.DecimalField(
        max_digits=6, decimal_places=1, null=True, blank=True,
        validators=[MinValueValidator(1), MaxValueValidator(5000)],
        help_text="ALT (Alanine transaminase) in U/L"
    )
    ast_u_l = models.DecimalField(
        max_digits=6, decimal_places=1, null=True, blank=True,
        validators=[MinValueValidator(1), MaxValueValidator(5000)],
        help_text="AST (Aspartate transaminase) in U/L"
    )
    alp_u_l = models.DecimalField(
        max_digits=6, decimal_places=1, null=True, blank=True,
        validators=[MinValueValidator(1), MaxValueValidator(5000)],
        help_text="ALP (Alkaline phosphatase) in U/L"
    )
    bilirubin_total_mgdl = models.DecimalField(
        max_digits=4, decimal_places=2, null=True, blank=True,
        validators=[MinValueValidator(0), MaxValueValidator(50)],
        help_text="Total bilirubin in mg/dL"
    )

    # Electrolytes
    sodium_mmol_l = models.DecimalField(
        max_digits=5, decimal_places=1, null=True, blank=True,
        validators=[MinValueValidator(100), MaxValueValidator(180)],
        help_text="Sodium in mmol/L"
    )
    potassium_mmol_l = models.DecimalField(
        max_digits=4, decimal_places=2, null=True, blank=True,
        validators=[MinValueValidator(1), MaxValueValidator(10)],
        help_text="Potassium in mmol/L"
    )
    chloride_mmol_l = models.DecimalField(
        max_digits=5, decimal_places=1, null=True, blank=True,
        validators=[MinValueValidator(70), MaxValueValidator(140)],
        help_text="Chloride in mmol/L"
    )
    bicarbonate_mmol_l = models.DecimalField(
        max_digits=4, decimal_places=1, null=True, blank=True,
        validators=[MinValueValidator(5), MaxValueValidator(45)],
        help_text="Bicarbonate in mmol/L"
    )

    # Hematology
    hemoglobin_g_dl = models.DecimalField(
        max_digits=4, decimal_places=1, null=True, blank=True,
        validators=[MinValueValidator(3), MaxValueValidator(25)],
        help_text="Hemoglobin in g/dL"
    )
    wbc_10e9_l = models.DecimalField(
        max_digits=4, decimal_places=1, null=True, blank=True,
        validators=[MinValueValidator(0.5), MaxValueValidator(200)],
        help_text="White blood cell count (x10^9/L)"
    )
    platelets_10e9_l = models.DecimalField(
        max_digits=5, decimal_places=1, null=True, blank=True,
        validators=[MinValueValidator(5), MaxValueValidator(2000)],
        help_text="Platelet count (x10^9/L)"
    )
    inr = models.DecimalField(
        max_digits=4, decimal_places=2, null=True, blank=True,
        validators=[MinValueValidator(0.5), MaxValueValidator(10)],
        help_text="INR (International Normalized Ratio)"
    )

    # Inflammation
    crp_mg_l = models.DecimalField(
        max_digits=6, decimal_places=1, null=True, blank=True,
        validators=[MinValueValidator(0), MaxValueValidator(1000)],
        help_text="C-reactive protein (CRP) in mg/L"
    )
    esr_mm_h = models.PositiveSmallIntegerField(
        null=True, blank=True,
        validators=[MinValueValidator(0), MaxValueValidator(200)],
        help_text="Erythrocyte sedimentation rate (ESR) in mm/h"
    )

    # Thyroid
    tsh_miu_l = models.DecimalField(
        max_digits=5, decimal_places=2, null=True, blank=True,
        validators=[MinValueValidator(0.01), MaxValueValidator(200)],
        help_text="Thyroid stimulating hormone (TSH) in mIU/L"
    )
    t3_ng_dl = models.DecimalField(
        max_digits=5, decimal_places=1, null=True, blank=True,
        validators=[MinValueValidator(10), MaxValueValidator(800)],
        help_text="Triiodothyronine (T3) in ng/dL"
    )
    t4_ug_dl = models.DecimalField(
        max_digits=4, decimal_places=2, null=True, blank=True,
        validators=[MinValueValidator(0.1), MaxValueValidator(30)],
        help_text="Thyroxine (T4) in µg/dL"
    )

    # Urinalysis
    urine_protein = models.BooleanField(
        null=True, blank=True,
        help_text="Urine protein presence (dipstick positive/negative)"
    )
    urine_glucose = models.BooleanField(
        null=True, blank=True,
        help_text="Urine glucose presence (dipstick positive/negative)"
    )
    urine_ketones = models.BooleanField(
        null=True, blank=True,
        help_text="Urine ketone presence (dipstick positive/negative)"
    )

    # Respiratory
    peak_flow_l_min = models.PositiveIntegerField(
        null=True, blank=True,
        validators=[MinValueValidator(50), MaxValueValidator(1200)],
        help_text="Peak expiratory flow in L/min"
    )
    fev1_l = models.DecimalField(
        max_digits=4, decimal_places=2, null=True, blank=True,
        validators=[MinValueValidator(0.1), MaxValueValidator(10)],
        help_text="FEV1 (Forced expiratory volume in 1 sec) in liters"
    )
    fvc_l = models.DecimalField(
        max_digits=4, decimal_places=2, null=True, blank=True,
        validators=[MinValueValidator(0.1), MaxValueValidator(10)],
        help_text="FVC (Forced vital capacity) in liters"
    )

    # Mental health screeners
    phq9_score = models.PositiveSmallIntegerField(
        null=True, blank=True,
        validators=[MinValueValidator(0), MaxValueValidator(27)],
        help_text="PHQ-9 depression screening score (0–27)"
    )
    gad7_score = models.PositiveSmallIntegerField(
        null=True, blank=True,
        validators=[MinValueValidator(0), MaxValueValidator(21)],
        help_text="GAD-7 anxiety screening score (0–21)"
    )

    # Reproductive
    pregnant_test_positive = models.BooleanField(
        null=True, blank=True,
        help_text="Pregnancy test result (True = positive, False = negative)"
    )

    # Source / metadata
    source = models.CharField(
        max_length=100, null=True, blank=True,
        help_text="Measurement source (manual, device, EHR import, etc.)"
    )
    notes = models.TextField(
        null=True, blank=True,
        help_text="Free text notes related to this measurement"
    )

    created_at = models.DateTimeField(
        auto_now_add=True, help_text="Record creation timestamp"
    )
    updated_at = models.DateTimeField(
        auto_now=True, help_text="Last update timestamp"
    )

    class Meta:
        indexes = [
            models.Index(fields=["user", "measured_at"]),
        ]
        ordering = ["-measured_at"]

    def __str__(self):
        return f"{self.user} @ {self.measured_at:%Y-%m-%d %H:%M}"

class Notification(ModelOwnerAbstract):
    title = models.CharField(max_length=200)
    message = models.TextField()
    acknowledged_at = models.DateTimeField(blank=True, null=True)

    def save(self, *args, **kawrgs):

        if not self.pk:
            firebase_msg = self.user.send_user_notification(
                title=self.title,
                message=self.message,
            )
            super(Notification, self).save(*args, **kawrgs)
            self.send_notification()
        else:
            super(Notification, self).save(*args, **kawrgs)

    def send_notification(self):
        channel_layer = get_channel_layer()
        async_to_sync(channel_layer.group_send)(
            f'user_{self.user.id}',
            {
                "type": "send_notification",
                "data": self.pk
            }
        )
