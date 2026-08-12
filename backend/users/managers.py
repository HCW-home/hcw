import logging

from django.contrib.auth.models import BaseUserManager
from django.db import IntegrityError, transaction
from django.db.models import F
from django.utils.translation import gettext_lazy as _

logger = logging.getLogger(__name__)


class UserManager(BaseUserManager):
    def find_by_email(self, email):
        """Return the account owning this address, ignoring case, or None.

        `email` is unique but that uniqueness is case-sensitive in PostgreSQL,
        while every authentication path looks the address up case-insensitively.
        Callers resolving a contact must therefore match the same way, otherwise
        "John@x.org" creates a second account for the owner of "john@x.org" and
        both accounts then break login with MultipleObjectsReturned.

        When duplicates already exist, prefer the account people actually use:
        active first, then most recently logged in.
        """
        if not email:
            return None

        matches = list(
            self.filter(email__iexact=email.strip()).order_by(
                "-is_active", F("last_login").desc(nulls_last=True), "pk"
            )[:2]
        )

        if len(matches) > 1:
            logger.warning(
                "Several accounts share the email %s, using #%s",
                email,
                matches[0].pk,
            )

        return matches[0] if matches else None

    def get_or_create_by_email(self, email, defaults=None):
        """Case-insensitive ``get_or_create`` on the email address."""
        user = self.find_by_email(email)
        if user is not None:
            return user, False

        fields = dict(defaults or {})
        fields["email"] = email.strip()
        try:
            with transaction.atomic():
                return self.create(**fields), True
        except IntegrityError:
            # Lost a race against a concurrent creation, or the address only
            # differs by case from a row this query did not see.
            user = self.find_by_email(email)
            if user is None:
                raise
            return user, False

    def create_user(self, email, password=None, **extra_fields):
        if not email:
            raise ValueError(_("The email is mandatory"))
        email = self.normalize_email(email)
        user = self.model(email=email, **extra_fields)
        user.set_password(password)
        user.save(using=self._db)
        return user

    def create_superuser(self, email, password=None, **extra_fields):
        extra_fields.setdefault("is_staff", True)
        extra_fields.setdefault("is_superuser", True)
        extra_fields.setdefault("is_practitioner", True)
        extra_fields.setdefault("is_active", True)

        if extra_fields.get("is_staff") is not True:
            raise ValueError("Superuser must have is_staff=True.")
        if extra_fields.get("is_superuser") is not True:
            raise ValueError("Superuser must have is_superuser=True.")

        return self.create_user(email, password, **extra_fields)
