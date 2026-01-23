import json
from fhir.resources.appointment import Appointment
from fhir.resources.codeableconcept import CodeableConcept
from fhir.resources.coding import Coding
from fhir.resources.reference import Reference

class AppointmentFhir:

    def __init__(self, data):
        self.data = data

    def to_fhir(self):

        appointment_data = self.data
        # Map status
        status_mapping = {
            "Draft": "pending",
            "Scheduled": "booked",
            "Cancelled": "cancelled",
        }
        fhir_status = status_mapping.get(appointment_data.get("status"), "pending")

        # Add participants
        participants_data = appointment_data.get("participants", [])
        participants = []
        for participant in participants_data:
            user = participant.get("user")
            fhir_participant = {
                "actor": {
                    "reference": f"Patient/{user.get('id')}" if user else None,
                    "display": participant.get("email") or f"{participant.get('first_name', '')} {participant.get('last_name', '')}".strip(),
                },
                "status": "accepted" if participant.get("is_confirmed") else "tentative",
            }
            participants.append(fhir_participant)

        # Add appointment type
        appointment_type = appointment_data.get("type")
        appointment_type_coding = None
        if appointment_type:
            appointment_type_coding = CodeableConcept(
                coding=[
                    Coding(
                        system="http://terminology.hl7.org/CodeSystem/v2-0276",
                        code="ROUTINE" if appointment_type == "Online" else "WALKIN",
                        display=appointment_type,
                    )
                ]
            )

        # Convert datetime strings to proper format
        scheduled_at = appointment_data.get("scheduled_at")
        end_expected_at = appointment_data.get("end_expected_at")
        created_at = appointment_data.get("created_at")

        # Build FHIR Appointment
        fhir_appointment = Appointment(
            resourceType="Appointment",
            id=str(appointment_data.get("id")),
            status=fhir_status,
            start=scheduled_at,
            end=end_expected_at,
            created=created_at,
            participant=participants,
            appointmentType=appointment_type_coding,
        )

        # Add description from consultation if available
        consultation = appointment_data.get("consultation")
        if consultation and isinstance(consultation, dict):
            fhir_appointment.description = (
                consultation.get("description") or consultation.get("title")
            )

        return fhir_appointment.model_dump()
