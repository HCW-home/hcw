import logging
from abc import ABC, abstractmethod
from importlib import import_module
from pkgutil import iter_modules
from typing import TYPE_CHECKING, Dict, List, Tuple, Type

logger = logging.getLogger(__name__)

from django.contrib.auth import get_user_model
from django.utils.translation import gettext_lazy as _

if TYPE_CHECKING:
    from ..models import Request

User = get_user_model()


class AssignmentException(Exception):
    pass


class BaseAssignmentHandler(ABC):
    """
    Base class for handling different assignment methods.
    Each assignment method should implement this interface.
    """

    display_name: str = ""
    required_fields: List[str] = []

    def __init__(self, request: "Request"):
        self.request = request

    @abstractmethod
    def process(self):
        """
        Process the request based on the assignment method.

        Returns:
            AssignmentResult: Result of the assignment operation
        """
        pass

    def _create_consultation(self):
        """
        Helper method to create a consultation for the request.

        Returns:
            Consultation: The created consultation instance
        """
        from ..models import Consultation

        consultation = Consultation.objects.create(
            created_by=self.request.created_by,
            owned_by=self.request.created_by,
            beneficiary=self.request.beneficiary or self.request.created_by,
            title=f"Consultation for {self.request.reason.name}",
            description=self.request.comment
            or f"Automated consultation creation for reason: {self.request.reason.name}",
        )
        return consultation

    def _create_participants(self, appointment, doctor):
        """
        Helper method to create participants for an appointment.

        Args:
            appointment: The appointment instance
            doctor: The assigned doctor user instance
        """

        if self.request.created_by == doctor:
            raise AssignmentException(
                "Unable to assign doctor and beneficiary to the same user"
            )

        from ..models import Participant

        # Create participant for requester
        Participant.objects.create(
            appointment=appointment,
            user=self.request.created_by,
            is_invited=True,
            is_confirmed=True,
        )

        # Create participant for doctor
        Participant.objects.create(
            appointment=appointment,
            user=doctor,
            is_invited=True,
            is_confirmed=True,
        )


class AssignmentManager:
    def __init__(self, request: "Request") -> None:
        self.request: Request = request

    def __enter__(self):
        return self

    @property
    def handler(self) -> BaseAssignmentHandler:
        _handler = getattr(
            import_module(
                f".{self.request.reason.assignment_method}",
                package=__name__,
            ),
            "AssignmentHandler",
        )
        return _handler(self.request)

    def __exit__(self, exc_type, exc_val, exc_tb):
        # Si une exception a eu lieu, ces paramètres ne sont pas None :
        # - exc_type : le type de l'exception (ex: ValueError)
        # - exc_val : l'instance de l'exception
        # - exc_tb : le traceback
        #
        from ..models import RequestStatus

        if exc_type is not None:
            if self.request.appointment:
                self.request.appointment.delete()
                self.request.appointment = None
            if self.request.consultation:
                self.request.consultation.delete()
                self.request.consultation = None
            self.request.status = RequestStatus.refused
            if exc_type == AssignmentException:
                self.request.refused_reason = f"{exc_val}"
            else:
                self.request.refused_reason = f"An unexpected error occured: {exc_val}"
            self.request.save()
            logger.error("Assignment exception: %s", exc_val)
            return

        # Provision encryption now that the consultation's recipients
        # (owned_by, group, beneficiary, ...) are finalised. The server
        # generates the consultation keypair, wraps it for the master and
        # for each recipient, then drops the in-memory private key.
        try:
            self._provision_consultation_encryption()
        except Exception:
            logger.exception(
                "Failed to provision consultation encryption for request %s",
                self.request.pk,
            )

        self.request.status = RequestStatus.accepted
        self.request.save()

    def _provision_consultation_encryption(self) -> None:
        """If platform encryption is enabled and the consultation was just
        created in clear by an assignment handler, generate a keypair and
        wrap it for the recipients (owned_by, beneficiary, queue,
        appointment participants).
        """
        from constance import config as constance_config
        from core.encryption import provision_consultation_keypair
        from ..models import Participant

        consultation = self.request.consultation
        if not consultation or consultation.is_encrypted:
            return
        if not constance_config.encryption_enabled:
            return
        if not constance_config.master_public_key:
            logger.warning(
                "Cannot provision consultation %s encryption: "
                "encryption_enabled but master_public_key empty",
                consultation.pk,
            )
            return

        # Collect recipients: owner, creator, beneficiary, plus every
        # active participant of the appointment (which the assignment
        # handler may have just created).
        user_recipients = []
        for u in (
            consultation.owned_by,
            consultation.created_by,
            consultation.beneficiary,
        ):
            if u and getattr(u, "pk", None):
                user_recipients.append(u)
        if self.request.appointment_id:
            user_recipients.extend(
                p.user
                for p in Participant.objects.filter(
                    appointment_id=self.request.appointment_id, is_active=True
                ).select_related("user")
                if p.user_id
            )

        queue_recipients = []
        if consultation.group_id and consultation.group:
            queue_recipients.append(consultation.group)

        provision_consultation_keypair(
            consultation,
            master_public_pem=constance_config.master_public_key,
            user_recipients=user_recipients,
            queue_recipients=queue_recipients,
        )


MAIN_CLASSES: Dict[str, Type[BaseAssignmentHandler]] = {}
MAIN_DISPLAY_NAMES: List[Tuple[str, str]] = []
__all__: List[str] = []

# __path__ is defined for packages; iter_modules lists names in this package dir
for _, module_name, _ in iter_modules(__path__):
    if module_name.startswith("_"):  # skip private modules
        continue
    module = import_module(f".{module_name}", __name__)
    globals()[module_name] = module  # expose as package attribute
    __all__.append(module_name)

    # Look for Main class that inherits from BaseProvider
    if hasattr(module, "AssignmentHandler") and issubclass(
        module.AssignmentHandler, BaseAssignmentHandler
    ):
        provider_class = module.AssignmentHandler
        MAIN_CLASSES[module_name] = provider_class
        MAIN_DISPLAY_NAMES.append((module_name, provider_class.display_name))
